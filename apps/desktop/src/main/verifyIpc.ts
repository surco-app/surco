import { readFile, stat } from 'node:fs/promises'
import { ipcMain, type WebContents } from 'electron'
import type { Verification } from '../shared/verification'
import { type EngineDb, openEngineDb } from './enginePlaylists'
import { pathKey } from './libraryPathKey'
import type { LibraryRepointResult } from './libraryRepointFlush'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { COLLECTION_WIDE, type QueueApply } from './rekordboxQueue'
import { stillWaiting } from './rekordboxQueueWatch'
import { queuedNmlPatch } from './traktorPatchQueue'
import { checkEngine, type EngineBefore, snapshotEngineRow } from './verifyEngine'
import type { QueueApplied, VerifyEntry, VerifyRegistryDeps } from './verifyRegistry'
import { checkRekordbox, type RekordboxBefore, snapshotRekordboxRow } from './verifyRekordbox'
import { checkTraktor } from './verifyTraktor'

// Every open window hears how a conversion's check went, as (trackId, verification): the
// preload hands both to the renderer the way the progress events do.
export function verifyUpdateSender(contents: () => WebContents[]) {
  return (trackId: string, verification: Verification): void => {
    for (const c of contents()) if (!c.isDestroyed()) c.send('verify:update', trackId, verification)
  }
}

export function registerVerifyIpc(registry: {
  retry: (trackId: string) => Promise<'rerun-job' | 'rechecked'>
}): void {
  ipcMain.handle('verify:retry', async (_e, trackId: unknown) => {
    return registry.retry(String(trackId))
  })
}

// The written file's size, or one no row can have when it is gone.
const sizeOf = (path: string) =>
  stat(path).then(
    (s) => s.size,
    () => -1,
  )

// Read-only, and closed the moment the answer is in: an open handle keeps the next write's
// wal_checkpoint busy and that write's backup fails.
function withDb<D extends { close: () => unknown }, T>(
  path: string,
  open: (path: string) => D | null,
  read: (db: D) => T,
): T | 'unreadable' {
  const db = path ? open(path) : null
  if (!db) return 'unreadable'
  try {
    return read(db)
  } finally {
    db.close()
  }
}

const openRekordboxReadOnly = (path: string) => openRekordboxDb(path, { readonly: true })

// The source's row in each library about to follow it, before anything writes. An empty
// path is a library not in play. Never rejects: a library it cannot read is unreadable.
export async function snapshotLibraries(
  from: string,
  at: { rekordbox: string; engine: string },
  realPath: (p: string) => string,
): Promise<{ rekordbox?: RekordboxBefore; engine?: EngineBefore }> {
  const out: { rekordbox?: RekordboxBefore; engine?: EngineBefore } = {}
  if (at.rekordbox)
    out.rekordbox = withDb(at.rekordbox, openRekordboxReadOnly, (db) =>
      snapshotRekordboxRow(db, from, { realPath, quiet: true }),
    )
  if (at.engine) {
    // Opening reads the database file itself, which can throw where rekordbox's open cannot.
    try {
      out.engine = withDb(at.engine, openEngineDb, (db) =>
        snapshotEngineRow(db, at.engine, from, pathKey({ realPath })),
      )
    } catch {
      out.engine = 'unreadable'
    }
  }
  return out
}

interface ReaderOptions {
  realPath: (p: string) => string
  bootVolume: () => string
  openEngine?: (dir: string) => EngineDb | null
  checkEngine?: typeof checkEngine
}

// One read of each library for a whole batch, after its flush or its queue applied.
export function libraryReaders(
  paths: { rekordbox: () => string; engine: () => string; traktor: () => string },
  options: ReaderOptions,
): Pick<VerifyRegistryDeps, 'readRekordbox' | 'readEngine' | 'readTraktor'> {
  const find: FindOptions = { realPath: options.realPath, quiet: true }
  const key = pathKey({ realPath: options.realPath })
  const openEngine = options.openEngine ?? openEngineDb
  const judgeEngine = options.checkEngine ?? checkEngine
  const sizes = (list: VerifyEntry[]) => Promise.all(list.map((e) => sizeOf(e.to)))
  return {
    readRekordbox: async (list) => {
      const size = await sizes(list)
      return withDb(paths.rekordbox(), openRekordboxReadOnly, (db) =>
        checkRekordbox(
          db,
          list.map((e, i) => ({
            from: e.from,
            to: e.to,
            samplesKept: e.samplesKept,
            before: e.rekordbox ?? 'unreadable',
            added: false,
            size: size[i],
          })),
          find,
        ),
      )
    },
    readEngine: async (list) => {
      const size = await sizes(list)
      const dir = paths.engine()
      return withDb(dir, openEngine, (db) =>
        judgeEngine(
          db,
          dir,
          list.map((e, i) => ({
            from: e.from,
            to: e.to,
            samplesKept: e.samplesKept,
            before: e.engine ?? 'unreadable',
            size: size[i],
            added: e.engineStep === true && typeof e.engine !== 'object',
          })),
          key,
        ),
      )
    },
    readTraktor: async (list) => {
      const path = paths.traktor()
      if (!path) return 'unreadable'
      return checkTraktor(await readFile(path, 'utf8'), list, options.bootVolume())
    },
  }
}

type Library = 'rekordbox' | 'engine' | 'traktor'

interface RequeueTarget<T> {
  enqueue: (ops: [], repoints: T[]) => void
  apply: () => void
  // Where the library is now, empty while it is not there.
  at: () => string
}

// A retry hands a library still on the old file the move again, with the cue shift the
// first repoint carried: that one never touched the row, and the shift goes with the move in
// the same write. A row already moved is not found by the old path, so nothing shifts twice.
// Tags, grid and stars are left out. True when the library is not there to take it now.
type Move = { from: string; to: string; audio?: { cueShiftMs: number } }
export function libraryRequeue(queues: {
  rekordbox: RequeueTarget<Move>
  engine: RequeueTarget<Move>
  traktor: RequeueTarget<ReturnType<typeof queuedNmlPatch>>
}): VerifyRegistryDeps['requeue'] {
  return (place, e) => {
    if (place === 'traktor') {
      const p = e.traktorPatch
      if (p)
        queues.traktor.enqueue(
          [],
          [
            queuedNmlPatch({
              volume: p.volume,
              dir: p.dir,
              file: p.file,
              newFile: p.newFile,
              ...(p.cueShift ? { cueShift: p.cueShift } : {}),
              // Where the file is: an entry that cannot take the new name (another holds
              // it) keeps its cues, so a retry shifts them only along with the move.
              outputVolume: p.outputVolume,
              outputDir: p.outputDir,
              outputFile: p.outputFile,
            }),
          ],
        )
    } else
      queues[place].enqueue(
        [],
        [
          {
            from: e.from,
            to: e.to,
            ...(e.cueShiftMs === undefined ? {} : { audio: { cueShiftMs: e.cueShiftMs } }),
          },
        ],
      )
    queues[place].apply()
    return !queues[place].at()
  }
}

// How each queue apply went, for the tracks held pending on it. Repoints that came back
// without a collection-wide refusal left the queue: whatever the rest of the apply did,
// they are read back. Otherwise a program still open keeps them pending, and any other
// refusal, a throw or a discarded queue is a failed apply, never left pending.
export function queueVerification(registry: {
  afterQueueApplied: (place: Library, result: QueueApplied) => Promise<void>
}) {
  const repointed: Partial<Record<Library, QueueApplied>> = {}
  return {
    repointed(place: Library, results: LibraryRepointResult[], write?: QueueApplied): void {
      if (results.every((r) => r.written || !COLLECTION_WIDE.has(r.reason)))
        repointed[place] = write ?? 'written'
    },
    settled(place: Library, result: QueueApply | 'threw'): void {
      const written = repointed[place]
      delete repointed[place]
      if (written) void registry.afterQueueApplied(place, written)
      else if (result === 'threw' || (result.status === 'refused' && !stillWaiting(result)))
        void registry.afterQueueApplied(place, 'failed')
    },
    discarded(place: Library): void {
      delete repointed[place]
      void registry.afterQueueApplied(place, 'failed')
    },
  }
}
