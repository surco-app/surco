import { existsSync, realpathSync } from 'node:fs'
import log from 'electron-log/main'
import type { LibraryStatus, LibraryTagUpdate, RekordboxSyncIssue } from '../shared/types'
import { activity } from './activity'
import {
  libraryOutcomes,
  type ReplaceDuplicatesDeps,
  traktorDuplicateStep,
} from './duplicateReplace'
import { replaceEngineDuplicates } from './engineDuplicates'
import { repointEngineTracks } from './engineRepoint'
import { ENGINE_KEYS, flushEngineSync } from './engineSyncFlush'
import { updateEngineTags } from './engineTags'
import { probeDuration, probeProperties, toNmlLocation } from './ffmpeg'
import { djLibraryFileUse } from './libraryFileUse'
import { flushLibraryRepoints, type LibraryRepointResult } from './libraryRepointFlush'
import { libraryStatus } from './libraryStatus'
import { nmlTagPatches } from './libraryTagPatches'
import { serialLibraryFlush, syncLibraryTags, tagSyncOf } from './libraryTagSync'
import { endNmlBatch } from './nmlBatch'
import { endRekordboxBatch, type RekordboxRepoint } from './rekordboxBatch'
import { replaceRekordboxDuplicates } from './rekordboxDuplicates'
import { type FlushResult, flushRekordboxSync, REKORDBOX_KEYS } from './rekordboxFlush'
import { repointTracks } from './rekordboxLibrary'
import { findRekordboxCollection } from './rekordboxPath'
import type { RekordboxQueue } from './rekordboxQueue'
import { queueConversionRun, trackOpsFromRun } from './rekordboxQueueFromRun'
import type { createSessionBackup } from './rekordboxSessionBackup'
import { updateRekordboxTags } from './rekordboxTags'
import { getSettings } from './settings'
import { readEmbeddedCover } from './tags'
import { replaceDuplicatesInCollection, syncCollection } from './traktorNmlLibrary'
import { holdInQueue } from './traktorPatchQueue'
import { flushTraktorSync } from './traktorSyncFlush'
import { sourceRoot } from './usbExport'

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
export type Sessions = { rekordbox: SessionBackup; engine: SessionBackup }

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

export function traktorFlushDeps(host: LibraryHost) {
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
    syncCollection,
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
export async function flushConversionBatch(
  host: LibraryHost,
  sessions: { rekordbox: SessionBackup; engine: SessionBackup },
  queue: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void },
  traktorQueue?: Parameters<typeof holdInQueue>[0],
  engineQueue?: { enqueue: RekordboxQueue['enqueue']; applyQuietly: () => void },
): Promise<void> {
  await flushTraktorSync({
    ...traktorFlushDeps(host),
    endNmlBatch,
    queue: traktorQueue && holdInQueue(traktorQueue),
  })
  // The run's repoints, taken once: rekordbox and Engine DJ each apply the same list to
  // their own library, and closing the batch twice would hand the second one nothing.
  const repoints = endRekordboxBatch()
  // rekordbox next, and independently: the two collections are separate libraries, so
  // one being open or unwritable must not stop the other from being updated.
  const rekordbox = rekordboxWriteDeps(host)
  const collectionPath = rekordboxCollectionPath()
  await queueConversionRun(repoints, {
    collectionPath,
    held: rekordbox.held,
    unplugged: onUnpluggedDrive(getSettings().rekordboxDbPath),
    flushRepoints: async (list) => {
      const result = await flushRekordboxSync({
        ...rekordbox,
        showBlockedDialog: () => {},
        endBatch: () => list,
        repointTracks: (path, items) => repointRekordbox(path, items, sessions),
      })
      logLibraryFlush('rekordbox repoint', result)
      return result
    },
    readOps: (list) =>
      trackOpsFromRun(collectionPath, list, {
        repointing: rekordbox.collectionPath !== '' || rekordbox.held,
        probe: { properties: probeProperties, duration: (p) => probeDuration(p) },
        find: { realPath: (p: string) => realpathSync(p) },
      }),
    enqueue: queue.enqueue,
    apply: queue.applyQuietly,
  })
  // Engine DJ last, again independently. Its library is the one the Engine destination
  // writes to. With Engine open the run waits in its queue, as rekordbox's does: the dialog
  // asked to convert again, which an in-place conversion cannot, its source being gone.
  const engineRepoints = repoints.filter((repoint) => repoint.from !== repoint.to)
  const engineResult = await flushEngineSync({
    ...engineFlushDeps(host),
    ...(engineQueue && { showBlockedDialog: () => {} }),
    endBatch: () => engineRepoints,
    repointTracks: (libraryDir, list) => repointEngine(libraryDir, list, sessions),
  })
  logLibraryFlush('Engine DJ repoint', engineResult)
  const unplugged =
    engineResult.blocked === 'collection-missing' &&
    onUnpluggedDrive(getSettings().engineLibraryDir)
  if (engineQueue && (engineResult.blocked === ENGINE_KEYS.runningReason || unplugged)) {
    engineQueue.enqueue([], engineRepoints)
    engineQueue.applyQuietly()
  }
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
// Session backups stay the ones a conversion run uses and are NOT reset here: both share
// the .surco-session suffix, so a reset would overwrite a running conversion's pre-run
// copy. The guarantee for this flow is the fresh .surco-backup that updateRekordboxTags
// and updateEngineTags take right before each write.
export function syncTagsInLibraries(
  updates: LibraryTagUpdate[],
  host: LibraryHost,
  sessions: Sessions,
) {
  const withRealPath = updates.map((u) => ({ ...u, realPath: (p: string) => realpathSync(p) }))
  return syncLibraryTags({
    traktor: () =>
      flushTraktorSync({
        ...traktorFlushDeps(host),
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
  const traktor = traktorFlushDeps(host)
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
            replace: replaceDuplicatesInCollection,
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
