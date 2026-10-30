import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import log from 'electron-log/main'
import type { LibraryStatus, LibraryTagUpdate, RekordboxSyncIssue } from '../shared/types'
import { activity } from './activity'
import {
  libraryOutcomes,
  type ReplaceDuplicatesDeps,
  traktorDuplicateStep,
} from './duplicateReplace'
import { loadSqlJs } from './engine'
import { replaceEngineDuplicates } from './engineDuplicates'
import { isEngineDjRunning } from './engineProcess'
import { engineRowFinder, repointEngineTracks } from './engineRepoint'
import { ENGINE_KEYS, flushEngineSync } from './engineSyncFlush'
import { updateEngineTags } from './engineTags'
import { probeDuration, probeProperties, toNmlLocation } from './ffmpeg'
import { djLibraryFileUse } from './libraryFileUse'
import { pathKey } from './libraryPathKey'
import { flushLibraryRepoints, type LibraryRepointResult } from './libraryRepointFlush'
import { libraryStatus } from './libraryStatus'
import { nmlTagPatches } from './libraryTagPatches'
import { serialLibraryFlush, syncLibraryTags, tagSyncOf } from './libraryTagSync'
import { endNmlBatch, nmlBatchOpen } from './nmlBatch'
import { endRekordboxBatch, type RekordboxRepoint, rekordboxBatchOpen } from './rekordboxBatch'
import { replaceRekordboxDuplicates } from './rekordboxDuplicates'
import { type FlushResult, flushRekordboxSync, REKORDBOX_KEYS } from './rekordboxFlush'
import { repointTracks } from './rekordboxLibrary'
import { findRekordboxCollection } from './rekordboxPath'
import type { RekordboxQueue } from './rekordboxQueue'
import { libraryTrackOps, queueConversionRun, trackOpsFromRun } from './rekordboxQueueFromRun'
import type { createSessionBackup } from './rekordboxSessionBackup'
import { updateRekordboxTags } from './rekordboxTags'
import { getSettings } from './settings'
import { readEmbeddedCover } from './tags'
import type { NmlPatch } from './traktorNml'
import {
  bootVolumeName,
  replaceDuplicatesInCollection,
  type SyncResult,
  syncCollection,
} from './traktorNmlLibrary'
import { holdInQueue } from './traktorPatchQueue'
import { traktorCollectionIndex } from './traktorPlaylists'
import { flushTraktorSync } from './traktorSyncFlush'
import { sourceRoot } from './usbExport'
import { type FlushOutcome, type TraktorWrite, traktorPatchKey } from './verifyRegistry'

export type SyncBlockedKey = 'traktorSyncBlocked' | 'rekordboxSyncBlocked' | 'engineSyncBlocked'

export interface LibraryHost {
  ensureTraktorClosed: () => Promise<boolean>
  ensureRekordboxClosed: () => Promise<boolean>
  ensureEngineDjClosed: () => Promise<boolean>
  showBlockedDialog: (key: SyncBlockedKey) => void
  reportIssue: (
    channel: 'rekordbox:sync-issue' | 'engine:sync-issue',
    issue: RekordboxSyncIssue,
  ) => void
  rekordboxHeld: () => boolean
}

type SessionBackup = ReturnType<typeof createSessionBackup>
export type Sessions = { rekordbox: SessionBackup; traktor: SessionBackup; engine: SessionBackup }

// A collection can live on an external drive. Gone because that drive is not mounted, it
// comes back when the drive does, unlike one deleted from a disk that is there.
function onUnpluggedDrive(path: string): boolean {
  const root = path ? sourceRoot(path, process.platform) : null
  return root !== null && !existsSync(root)
}

export function currentLibraryStatus(): LibraryStatus {
  return libraryStatus(getSettings(), existsSync)
}

export function rekordboxCollectionPath(): string {
  return currentLibraryStatus().rekordbox.found
    ? findRekordboxCollection({ configured: getSettings().rekordboxDbPath })
    : ''
}

export function repointRekordbox(
  collectionPath: string,
  list: RekordboxRepoint[],
  sessions: Pick<Sessions, 'rekordbox'>,
) {
  return repointTracks(
    collectionPath,
    list.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
    {
      sessionBackup: (db) => sessions.rekordbox.ensure(db),
      readCover: readEmbeddedCover,
    },
  )
}

export function traktorFlushDeps(host: LibraryHost, session: SessionBackup) {
  return {
    // Same rule as rekordbox below: the toggle grants permission, the path only says
    // where. Before these toggles a filled-in path meant both, which is why anyone
    // already syncing is migrated to syncTraktor: true (see syncToggleMigration.ts).
    traktorNmlPath:
      getSettings().syncTraktor && currentLibraryStatus().traktor.found
        ? getSettings().traktorNmlPath
        : '',
    collectionMissing: getSettings().syncTraktor && !currentLibraryStatus().traktor.found,
    unplugged: onUnpluggedDrive(getSettings().traktorNmlPath),
    ensureTraktorClosed: host.ensureTraktorClosed,
    showBlockedDialog: () => host.showBlockedDialog('traktorSyncBlocked'),
    syncCollection: (nmlPath: string, patches: Parameters<typeof syncCollection>[1]) =>
      syncCollection(nmlPath, patches, session),
    track: activity.track.bind(activity),
  }
}

export function rekordboxFlushDeps(host: LibraryHost) {
  return {
    // The toggle decides, not the path: a collection sitting in its standard location is
    // not permission to write to it. An empty path here skips the flush entirely.
    collectionPath: getSettings().syncRekordbox ? rekordboxCollectionPath() : '',
    collectionMissing: getSettings().syncRekordbox && !currentLibraryStatus().rekordbox.found,
    ensureClosed: host.ensureRekordboxClosed,
    track: activity.track.bind(activity),
    showBlockedDialog: () => host.showBlockedDialog('rekordboxSyncBlocked'),
    reportIssue: (issue: RekordboxSyncIssue) => host.reportIssue('rekordbox:sync-issue', issue),
  }
}

function rekordboxWriteDeps(host: LibraryHost) {
  const deps = rekordboxFlushDeps(host)
  const held = deps.collectionPath !== '' && host.rekordboxHeld()
  return { ...deps, collectionPath: held ? '' : deps.collectionPath, held }
}

export function engineFlushDeps(host: LibraryHost) {
  // With no m.db there yet there is nothing to write to.
  const engineDir = getSettings().engineLibraryDir
  return {
    collectionPath:
      getSettings().syncEngineDj && currentLibraryStatus().engine.found ? engineDir : '',
    collectionMissing: getSettings().syncEngineDj && !currentLibraryStatus().engine.found,
    ensureClosed: host.ensureEngineDjClosed,
    track: activity.track.bind(activity),
    showBlockedDialog: () => host.showBlockedDialog('engineSyncBlocked'),
    reportIssue: (issue: RekordboxSyncIssue) => host.reportIssue('engine:sync-issue', issue),
  }
}

// Logged in every case, on top of the dialog for the app being open and the notice
// for everything else the run could not do (see flushLibraryRepoints).
export function logLibraryFlush(label: string, result: FlushResult): void {
  if (result.written > 0 || result.blocked || result.skipped.length > 0) {
    log.info(
      `${label}: ${result.written} written` +
        `${result.blocked ? `, stopped by ${result.blocked}` : ''}` +
        // Named, not counted: three runs of "1 skipped" said nothing about WHY, and the
        // reason is the whole diagnosis — an ambiguous match, a missing output and a
        // track the collection never had are different problems with different fixes.
        `${result.skipped.length > 0 ? `, skipped ${result.skipped.map((s) => `${s.reason} (${s.track})`).join('; ')}` : ''}`,
    )
  }
}

// A convert-all run ends (however it ended — finished, cancelled, or failed, the
// renderer calls this from its finally block): flush whatever Traktor cue patches the
// batch recorded into collection.nml in one write. A failure here must never surface as
// a conversion failure — the audio is already correct on disk by this point — so every
// branch below only logs and returns, never throws back at the renderer.
//
// It answers what became of each library, for the check that reads them back: written,
// held in its queue, not in play, failed, or left for the outer end of a nested batch.
// Traktor's write carries the entry each patch matched in the collection it replaced.
export async function flushConversionBatch(
  host: LibraryHost,
  sessions: Sessions,
  queue: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void },
  traktorQueue?: Parameters<typeof holdInQueue>[0],
  engineQueue?: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void },
): Promise<FlushOutcome> {
  const traktorDeps = traktorFlushDeps(host, sessions.traktor)
  const traktorHold = traktorQueue && holdInQueue(traktorQueue)
  let patches: NmlPatch[] = []
  let synced: { patches: NmlPatch[]; result: SyncResult } | undefined
  let traktorHeld = false
  // An end nested in a batch still open takes nothing: the outer end flushes, and judges.
  let traktorLater = false
  await flushTraktorSync({
    ...traktorDeps,
    endNmlBatch: () => {
      patches = endNmlBatch()
      traktorLater = nmlBatchOpen()
      return patches
    },
    syncCollection: async (path, list) => {
      const result = await traktorDeps.syncCollection(path, list)
      synced = { patches: list, result }
      return result
    },
    queue: traktorHold && {
      waiting: traktorHold.waiting,
      hold: (list, path) => {
        traktorHeld = true
        return traktorHold.hold(list, path)
      },
    },
  })
  const traktor: FlushOutcome['traktor'] = traktorLater
    ? 'later'
    : patches.length === 0
      ? 'off'
      : traktorHeld
        ? 'queued'
        : synced
          ? traktorWrite(synced.patches, synced.result)
          : traktorDeps.collectionMissing
            ? 'failed'
            : 'off'
  // The run's repoints, taken once: rekordbox and Engine DJ each apply the same list to
  // their own library, and closing the batch twice would hand the second one nothing.
  const repoints = endRekordboxBatch()
  const repointsLater = rekordboxBatchOpen()
  const addable = repoints.some((repoint) => repoint.meta)
  const addToTraktor = getSettings().addToTraktor
  const traktorOps = libraryTrackOps(
    repoints,
    'traktor',
    undefined,
    addToTraktor,
    addToTraktor && addable
      ? await traktorCollectionHas(getSettings().traktorNmlPath, getSettings().syncTraktor)
      : undefined,
  )
  if (traktorQueue && traktorOps.length > 0) {
    traktorQueue.enqueue(traktorOps)
    traktorQueue.applyQuietly()
  }
  // rekordbox next, and independently: the two collections are separate libraries, so
  // one being open or unwritable must not stop the other from being updated.
  const rekordbox = rekordboxWriteDeps(host)
  const collectionPath = rekordboxCollectionPath()
  const rekordboxUnplugged = onUnpluggedDrive(getSettings().rekordboxDbPath)
  let rekordboxResult: FlushResult | undefined
  let rekordboxQueued = false
  await queueConversionRun(repoints, {
    collectionPath,
    held: rekordbox.held,
    unplugged: rekordboxUnplugged,
    flushRepoints: async (list) => {
      const result = await flushRekordboxSync({
        ...rekordbox,
        unplugged: rekordboxUnplugged,
        showBlockedDialog: () => {},
        endBatch: () => list,
        repointTracks: (path, items) => repointRekordbox(path, items, sessions),
      })
      logLibraryFlush('rekordbox repoint', result)
      rekordboxResult = result
      return result
    },
    readOps: (list) =>
      trackOpsFromRun(collectionPath, list, {
        repointing: rekordbox.collectionPath !== '' || rekordbox.held,
        probe: { properties: probeProperties, duration: (p) => probeDuration(p) },
        find: { realPath: (p: string) => realpathSync(p) },
        addNew: getSettings().addToRekordbox,
      }),
    enqueue: (ops, waiting) => {
      if (waiting && waiting.length > 0) rekordboxQueued = true
      queue.enqueue(ops, waiting)
    },
    apply: queue.applyQuietly,
  })
  // Engine DJ last, again independently. Its library is the one the Engine destination
  // writes to. With Engine open the run waits in its queue without asking to close it, as
  // rekordbox's does: the dialog asked to convert again, which an in-place conversion
  // cannot, its source being gone. A check that cannot tell counts as Engine being open.
  const engineRepoints = repoints.filter((repoint) => repoint.from !== repoint.to)
  const engineUnplugged = onUnpluggedDrive(getSettings().engineLibraryDir)
  const engineDeps = engineFlushDeps(host)
  const engineResult = await flushEngineSync({
    ...engineDeps,
    ...(engineQueue && {
      ensureClosed: async () => !(await isEngineDjRunning().catch(() => true)),
      showBlockedDialog: () => {},
      unplugged: engineUnplugged,
    }),
    endBatch: () => engineRepoints,
    repointTracks: (libraryDir, list) => repointEngine(libraryDir, list, sessions),
  })
  logLibraryFlush('Engine DJ repoint', engineResult)
  const unplugged = engineResult.blocked === 'collection-missing' && engineUnplugged
  const engineQueued =
    engineQueue !== undefined && (engineResult.blocked === ENGINE_KEYS.runningReason || unplugged)
  if (engineQueued) {
    engineQueue.enqueue([], engineRepoints)
    engineQueue.applyQuietly()
  }
  const addToEngineDj = getSettings().addToEngineDj
  const engineOps = libraryTrackOps(
    repoints,
    'engine',
    undefined,
    addToEngineDj,
    addToEngineDj && addable
      ? await engineLibraryHas(getSettings().engineLibraryDir, getSettings().syncEngineDj)
      : undefined,
  )
  if (engineQueue && engineOps.length > 0) {
    engineQueue.enqueue(engineOps)
    engineQueue.applyQuietly()
  }
  return {
    rekordbox: repointOutcome(
      repointsLater,
      repoints.length,
      rekordboxQueued,
      rekordboxResult,
      rekordbox.collectionPath,
    ),
    engine: repointOutcome(
      repointsLater,
      engineRepoints.length,
      engineQueued,
      engineResult,
      engineDeps.collectionPath,
    ),
    traktor,
  }
}

function repointOutcome(
  later: boolean,
  count: number,
  queued: boolean,
  result: FlushResult | undefined,
  collectionPath: string,
): FlushOutcome['rekordbox'] {
  if (later) return 'later'
  if (count === 0) return 'off'
  if (queued) return 'queued'
  if (result?.blocked) return 'failed'
  return collectionPath ? 'written' : 'off'
}

// A collection write as the check needs it: the entry each patch matched, by the identity
// the queue keeps (traktorPatchKey). A write that never read the collection knows nothing.
export function traktorWrite(patches: NmlPatch[], result: SyncResult): TraktorWrite {
  const before = result.before
  if (!before) return 'failed'
  return { before: new Map(patches.map((p, i) => [traktorPatchKey(p), before[i] ?? null])) }
}

type LibraryHas = (path: string, from?: string) => boolean

function pathsHeld(path: string, from: string | undefined, followsFrom: boolean): string[] {
  return followsFrom && from !== undefined ? [path, from] : [path]
}

async function traktorCollectionHas(
  nmlPath: string,
  followsFrom: boolean,
): Promise<LibraryHas | undefined> {
  let nml: string
  try {
    nml = await readFile(nmlPath, 'utf8')
  } catch {
    return undefined
  }
  const { byPath } = traktorCollectionIndex(nml, bootVolumeName())
  return (path, from) =>
    pathsHeld(path, from, followsFrom).some((p) => byPath.has(p.normalize('NFC')))
}

async function engineLibraryHas(
  libraryDir: string,
  followsFrom: boolean,
): Promise<LibraryHas | undefined> {
  let rows: { path: string }[]
  try {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
    try {
      rows = (db.exec('SELECT path FROM Track WHERE path IS NOT NULL')[0]?.values ?? []).map(
        ([stored]) => ({ path: String(stored) }),
      )
    } finally {
      db.close()
    }
  } catch {
    return undefined
  }
  const find = engineRowFinder(libraryDir, rows)
  const key = pathKey({ realPath: (p: string) => realpathSync(p) })
  return (path, from) => pathsHeld(path, from, followsFrom).some((p) => find(p, key).length > 0)
}

function repointEngine(
  libraryDir: string,
  list: RekordboxRepoint[],
  sessions: Pick<Sessions, 'engine'>,
) {
  return repointEngineTracks(
    libraryDir,
    list.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
    { sessionBackup: (path) => sessions.engine.ensure(path) },
  )
}

// The queue knows one reason for the app being open, the name it got from rekordbox, and
// keeps the repoints only for that one.
export async function repointEngineQueued(
  libraryDir: string,
  list: RekordboxRepoint[],
  sessions: Pick<Sessions, 'engine'>,
): Promise<LibraryRepointResult[]> {
  const results = await repointEngine(libraryDir, list, sessions)
  return results.map((result) =>
    !result.written && result.reason === ENGINE_KEYS.runningReason
      ? { written: false, reason: 'rekordbox-running' }
      : result,
  )
}

// The names a metadata review fixed (or undid) follow the file into each library the way
// an Update's do: same toggles, same prompt to close the app, same dialogs and Activity
// rows as the end of a conversion run. Each library hears about every field Music took,
// written to the file or not, and answers with what it did so the done sheet can say so.
// The review is its own momento, begun when its turn in the write chain comes so it never
// relabels a flush still writing, and only when there is something to sync.
export function syncTagsInLibraries(
  updates: LibraryTagUpdate[],
  host: LibraryHost,
  sessions: Sessions,
  beginMoment: () => void,
) {
  const withRealPath = updates.map((u) => ({ ...u, realPath: (p: string) => realpathSync(p) }))
  return syncLibraryTags({
    traktor: () =>
      flushTraktorSync({
        ...traktorFlushDeps(host, sessions.traktor),
        endNmlBatch: () => nmlTagPatches(updates, toNmlLocation),
      }),
    rekordbox: async () => {
      const result = await flushLibraryRepoints(
        {
          ...rekordboxWriteDeps(host),
          endBatch: () => updates,
          labelOf: (u) => u.path,
          repointTracks: (collectionPath, list) =>
            updateRekordboxTags(collectionPath, list, {
              realPath: (p: string) => realpathSync(p),
              sessionBackup: (path) => sessions.rekordbox.ensure(path),
            }),
        },
        { ...REKORDBOX_KEYS, written: 'activity.rekordboxTagsWritten' },
      )
      logLibraryFlush('rekordbox tags', result)
      return tagSyncOf(result, REKORDBOX_KEYS.runningReason)
    },
    engine: async () => {
      const result = await flushLibraryRepoints(
        {
          ...engineFlushDeps(host),
          endBatch: () => withRealPath,
          labelOf: (u) => u.path,
          repointTracks: (libraryDir, list) =>
            updateEngineTags(libraryDir, list, {
              sessionBackup: (path) => sessions.engine.ensure(path),
            }),
        },
        { ...ENGINE_KEYS, written: 'activity.engineTagsWritten' },
      )
      logLibraryFlush('Engine DJ tags', result)
      return tagSyncOf(result, ENGINE_KEYS.runningReason)
    },
    warn: (library, error) => log.warn(`library:syncTags ${library} failed`, error),
    ...(updates.length > 0 && { begin: beginMoment }),
  })
}

// A removed duplicate copy: each library with its sync on moves to the copy the user kept,
// through the same prompts, dialogs and Activity rows as the other flushes.
export function duplicateLibraryDeps(
  host: LibraryHost,
  sessions: Sessions,
): Omit<ReplaceDuplicatesDeps, 'trash' | 'musicStep' | 'log'> {
  const realPath = (p: string) => realpathSync(p)
  const rekordbox = rekordboxFlushDeps(host)
  const engine = engineFlushDeps(host)
  const traktor = traktorFlushDeps(host, sessions.traktor)
  const keys = { written: 'activity.duplicatesReplaced' }
  return {
    libraries: {
      ...((rekordbox.collectionPath || rekordbox.collectionMissing) && {
        rekordbox: (list) =>
          libraryOutcomes(
            list,
            (run) =>
              flushLibraryRepoints(
                {
                  ...rekordbox,
                  endBatch: () => list,
                  labelOf: (p) => p.from,
                  repointTracks: run,
                },
                { ...REKORDBOX_KEYS, ...keys },
              ),
            (path, items) =>
              replaceRekordboxDuplicates(path, items, {
                realPath,
                sessionBackup: (db) => sessions.rekordbox.ensure(db),
                held: host.rekordboxHeld,
              }),
          ),
      }),
      ...((engine.collectionPath || engine.collectionMissing) && {
        engine: (list) =>
          libraryOutcomes(
            list,
            (run) =>
              flushLibraryRepoints(
                { ...engine, endBatch: () => list, labelOf: (p) => p.from, repointTracks: run },
                { ...ENGINE_KEYS, ...keys },
              ),
            (path, items) =>
              replaceEngineDuplicates(path, items, {
                realPath,
                sessionBackup: (db) => sessions.engine.ensure(db),
              }),
          ),
      }),
      ...(traktor.collectionMissing && {
        traktor: async (list) => {
          await traktor.track('export', 'activity.traktorSync', async () => ({}), {
            summary: () => ({ detailKey: 'activity.traktorSyncCollectionMissing' }),
          })
          return list.map(() => 'skipped' as const)
        },
      }),
      ...(traktor.traktorNmlPath && {
        traktor: (list) =>
          traktorDuplicateStep(list, {
            nmlPath: traktor.traktorNmlPath,
            ensureTraktorClosed: traktor.ensureTraktorClosed,
            showBlockedDialog: traktor.showBlockedDialog,
            track: traktor.track,
            replace: (nmlPath, pairs) =>
              replaceDuplicatesInCollection(nmlPath, pairs, sessions.traktor),
          }),
      }),
    },
    usedByLibrary: djLibraryFileUse(
      {
        rekordbox: rekordbox.collectionPath,
        engine: engine.collectionPath,
        traktor: traktor.traktorNmlPath,
      },
      { realPath },
    ),
    serial: serialLibraryFlush,
    warn: (message, error) => log.warn(message, error),
  }
}
