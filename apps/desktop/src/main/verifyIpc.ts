import { readFile, stat } from 'node:fs/promises'
import { ipcMain, type WebContents } from 'electron'
import type { Verification } from '../shared/verification'
import { type EngineDb, openEngineDb } from './enginePlaylists'
import { pathKey } from './libraryPathKey'
import { type FindOptions, openRekordboxDb } from './rekordboxDb'
import { checkEngine, type EngineBefore, snapshotEngineRow } from './verifyEngine'
import type { VerifyEntry, VerifyRegistryDeps } from './verifyRegistry'
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
