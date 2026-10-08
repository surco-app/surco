import {
  type FlushLibraryDeps,
  type FlushResult,
  flushLibraryRepoints,
} from './libraryRepointFlush'

export type { FlushResult, SkippedRepoint } from './libraryRepointFlush'

export type FlushRekordboxDeps = FlushLibraryDeps

// rekordbox's wording for the shared repoint flush (see libraryRepointFlush.ts).
export const REKORDBOX_KEYS = {
  step: 'activity.rekordboxSync',
  written: 'activity.rekordboxSyncWritten',
  skipped: 'activity.rekordboxSyncSkipped',
  nothing: 'activity.rekordboxSyncNothing',
  running: 'activity.rekordboxSyncRunning',
  backupFailed: 'activity.rekordboxSyncBackupFailed',
  readOnly: 'activity.rekordboxSyncReadOnly',
  unreadable: 'activity.rekordboxSyncUnreadable',
  writeFailed: 'activity.rekordboxSyncWriteFailed',
  runningReason: 'rekordbox-running',
  collectionMissing: 'activity.rekordboxCollectionMissing',
}

export function flushRekordboxSync(deps: FlushRekordboxDeps): Promise<FlushResult> {
  return flushLibraryRepoints(deps, REKORDBOX_KEYS)
}
