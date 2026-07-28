import type { Activity } from './activity'
import type { NmlPatch } from './traktorNml'
import type { SyncResult } from './traktorNmlLibrary'

// The process:batch-end flow, lifted out of the IPC handler so it can be unit-tested
// without booting Electron — same shape as processTrack.ts. Every collaborator that
// touches Electron (the quit-confirm dialog, the actual file write) arrives through
// deps; this function only sequences the four outcomes: no path configured, nothing
// recorded, the user declined to close Traktor, or a sync attempt (written or skipped).

// Every non-write reason syncCollection can return, mapped to the activity row's detail
// line. 'traktor-running' can't reach flushTraktorSync in practice (ensureTraktorClosed
// already refused earlier), but syncCollection re-checks right before its own write for
// a race, so the map still needs an entry for it.
export const TRAKTOR_SYNC_SKIP_KEYS: Record<NonNullable<SyncResult['reason']>, string> = {
  'traktor-running': 'activity.traktorSyncTraktorRunning',
  'backup-failed': 'activity.traktorSyncBackupFailed',
  'no-matches': 'activity.traktorSyncNoMatches',
  unreadable: 'activity.traktorSyncUnreadable',
  'write-failed': 'activity.traktorSyncWriteFailed',
}

export interface FlushTraktorSyncDeps {
  traktorNmlPath: string
  takeNmlPatches: () => NmlPatch[]
  // Resolves true once Traktor is confirmed not running (possibly after the user
  // accepted quitting it); false if it's running and the user declined.
  ensureTraktorClosed: () => Promise<boolean>
  // Shown only on decline, so the user knows the collection was NOT updated.
  showBlockedDialog: () => void
  syncCollection: (nmlPath: string, patches: NmlPatch[]) => Promise<SyncResult>
  track: Activity['track']
}

export async function flushTraktorSync(deps: FlushTraktorSyncDeps): Promise<void> {
  if (!deps.traktorNmlPath) return
  const patches = deps.takeNmlPatches()
  if (patches.length === 0) return
  if (!(await deps.ensureTraktorClosed())) {
    deps.showBlockedDialog()
    return
  }
  await deps.track(
    'export',
    'activity.traktorSync',
    () => deps.syncCollection(deps.traktorNmlPath, patches),
    {
      summary: (result) => {
        if (result.written) {
          return { detailKey: 'activity.traktorSyncWritten', detailParams: { count: result.matched } }
        }
        // A skip with no reason can't happen today (every written:false branch in
        // syncCollection sets one) but the type leaves it optional, and `?? 'unreadable'`
        // would report a false cause instead of admitting the gap. Falls back to a raw
        // detail rather than inventing an i18n key for a branch that never fires.
        if (!result.reason) return { detail: 'reason unknown' }
        return { detailKey: TRAKTOR_SYNC_SKIP_KEYS[result.reason] }
      },
    },
  )
}
