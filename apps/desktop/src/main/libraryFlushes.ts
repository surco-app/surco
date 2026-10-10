import { existsSync, realpathSync } from 'node:fs'
import log from 'electron-log/main'
import type { LibraryStatus, RekordboxSyncIssue } from '../shared/types'
import { activity } from './activity'
import { repointEngineTracks } from './engineRepoint'
import { flushEngineSync } from './engineSyncFlush'
import { libraryStatus } from './libraryStatus'
import { endNmlBatch } from './nmlBatch'
import { endRekordboxBatch } from './rekordboxBatch'
import { type FlushResult, flushRekordboxSync } from './rekordboxFlush'
import { repointTracks } from './rekordboxLibrary'
import { findRekordboxCollection } from './rekordboxPath'
import type { createSessionBackup } from './rekordboxSessionBackup'
import { getSettings } from './settings'
import { readEmbeddedCover } from './tags'
import { syncCollection } from './traktorNmlLibrary'
import { flushTraktorSync } from './traktorSyncFlush'

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
}

type SessionBackup = ReturnType<typeof createSessionBackup>

export function currentLibraryStatus(): LibraryStatus {
  return libraryStatus(getSettings(), existsSync)
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
    collectionPath:
      getSettings().syncRekordbox && currentLibraryStatus().rekordbox.found
        ? findRekordboxCollection({ configured: getSettings().rekordboxDbPath })
        : '',
    collectionMissing: getSettings().syncRekordbox && !currentLibraryStatus().rekordbox.found,
    ensureClosed: host.ensureRekordboxClosed,
    track: activity.track.bind(activity),
    showBlockedDialog: () => host.showBlockedDialog('rekordboxSyncBlocked'),
    reportIssue: (issue: RekordboxSyncIssue) => host.reportIssue('rekordbox:sync-issue', issue),
  }
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
): Promise<void> {
  await flushTraktorSync({ ...traktorFlushDeps(host), endNmlBatch })
  // The run's repoints, taken once: rekordbox and Engine DJ each apply the same list to
  // their own library, and closing the batch twice would hand the second one nothing.
  const repoints = endRekordboxBatch()
  // rekordbox next, and independently: the two collections are separate libraries, so
  // one being open or unwritable must not stop the other from being updated.
  const result = await flushRekordboxSync({
    ...rekordboxFlushDeps(host),
    endBatch: () => repoints,
    repointTracks: (collectionPath, repoints) =>
      repointTracks(
        collectionPath,
        repoints.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
        {
          sessionBackup: (path) => sessions.rekordbox.ensure(path),
          readCover: readEmbeddedCover,
        },
      ),
  })
  logLibraryFlush('rekordbox repoint', result)
  // Engine DJ last, again independently. Its library is the one the Engine destination
  // writes to.
  const engineResult = await flushEngineSync({
    ...engineFlushDeps(host),
    endBatch: () => repoints.filter((repoint) => repoint.from !== repoint.to),
    repointTracks: (libraryDir, list) =>
      repointEngineTracks(
        libraryDir,
        list.map((repoint) => ({ ...repoint, realPath: (p: string) => realpathSync(p) })),
        { sessionBackup: (path) => sessions.engine.ensure(path) },
      ),
  })
  logLibraryFlush('Engine DJ repoint', engineResult)
}
