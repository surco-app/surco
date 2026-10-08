import {
  type FlushLibraryDeps,
  type FlushResult,
  flushLibraryRepoints,
} from './libraryRepointFlush'

// Engine DJ's wording for the shared repoint flush (see libraryRepointFlush.ts). The reason
// for Engine being open is the one engineRepoint.ts returns.
export const ENGINE_KEYS = {
  step: 'activity.engineSync',
  written: 'activity.engineSyncWritten',
  skipped: 'activity.engineSyncSkipped',
  nothing: 'activity.engineSyncNothing',
  running: 'activity.engineSyncRunning',
  backupFailed: 'activity.engineSyncBackupFailed',
  readOnly: 'activity.engineSyncUnreadable',
  unreadable: 'activity.engineSyncUnreadable',
  writeFailed: 'activity.engineSyncWriteFailed',
  runningReason: 'engine-running',
  collectionMissing: 'activity.engineCollectionMissing',
}

export function flushEngineSync(deps: FlushLibraryDeps): Promise<FlushResult> {
  return flushLibraryRepoints(deps, ENGINE_KEYS)
}
