import { useEffect } from 'react'
import { WRITABLE_PROGRAMS, type WritableProgram } from '../../../shared/djProgram'
import type { RekordboxSyncIssue } from '../../../shared/types'
import type { AppStore } from '../lib/appStore'
import { baseName } from '../lib/baseName'
import { dismissToast, pushToast } from '../lib/toastQueue'
import { NEW_TRACKS_PROMPT_TIMEOUT_MS } from './useTrackLibrary'

const SYNC_ISSUES: Record<
  WritableProgram,
  {
    listen: (cb: (issue: RekordboxSyncIssue) => void) => () => void
    messages: 'rekordboxIssue' | 'engineIssue'
  } | null
> = {
  rekordbox: {
    listen: (cb) => window.api.dj.onSyncIssue('rekordbox', cb),
    messages: 'rekordboxIssue',
  },
  traktor: null,
  engine: { listen: (cb) => window.api.dj.onSyncIssue('engine', cb), messages: 'engineIssue' },
  virtualdj: null,
}

interface AppNotificationsInput {
  store: AppStore
  pendingNew: { root: string; paths: string[] } | null
  loadPending: () => void
  dismissPending: () => void
}

export function useAppNotifications({
  store,
  pendingNew,
  loadPending,
  dismissPending,
}: AppNotificationsInput): void {
  // The watcher's "N new tracks" prompt rides the same queue as every other toast: keyed so a
  // second copy-in updates the count in place, and with a Load action that adds the tracks.
  // Re-pushed whenever the pending set changes; dismissed when it clears (the user accepted,
  // the countdown declined it, or the crate was emptied). The countdown is the toast's own,
  // so it holds while the pointer rests on the card, and expiring declines like the ✕.
  useEffect(() => {
    if (!pendingNew) return
    // Both separators — the watcher root is a raw OS path, backslashed on Windows.
    const folder = pendingNew.root.split(/[/\\]/).pop() || pendingNew.root
    const id = pushToast(store, {
      key: 'new-tracks',
      tone: 'neutral',
      testid: 'new-tracks',
      message: { key: 'newTracks.prompt', values: { count: pendingNew.paths.length, folder } },
      action: { label: { key: 'newTracks.load' }, onAction: loadPending },
      onDismiss: dismissPending,
      onExpire: dismissPending,
      duration: NEW_TRACKS_PROMPT_TIMEOUT_MS,
    })
    return () => dismissToast(store, id)
  }, [pendingNew, loadPending, dismissPending, store])

  // The auto-updater reports a downloaded version (or a download failure) over IPC; surface
  // each as a toast instead of a bespoke component. The ready prompt offers Restart (applies
  // it immediately); a failure is a plain danger toast. Each kind has its own key, so a retry
  // supersedes its own stale card rather than stacking, and a failed check can never take
  // the place of a downloaded update still waiting for its restart.
  useEffect(
    () =>
      window.api.onUpdateDownloaded((version) =>
        pushToast(store, {
          key: 'update',
          tone: 'neutral',
          testid: 'update',
          message: { key: 'update.ready', values: { version } },
          action: { label: { key: 'update.restart' }, onAction: () => window.api.installUpdate() },
        }),
      ),
    [store],
  )
  // What a run's rekordbox or Engine DJ repoint could not do: the library stays on the old
  // file, so the DJ has to hear it now rather than when a track fails to load at the gig.
  useEffect(() => {
    const stops = WRITABLE_PROGRAMS.flatMap((program) => {
      const issues = SYNC_ISSUES[program]
      if (!issues) return []
      return [
        issues.listen((issue) =>
          pushToast(store, {
            key: `${program}-sync-issue`,
            tone: 'danger',
            testid: `${program}-sync-issue`,
            message: issue.blocked
              ? { key: `${issues.messages}.${issue.blocked}` }
              : {
                  key: `${issues.messages}.ambiguous`,
                  values: {
                    count: issue.ambiguous.length,
                    name: baseName(issue.ambiguous[0] ?? ''),
                  },
                },
          }),
        ),
      ]
    })
    return () => {
      for (const stop of stops) stop()
    }
  }, [store])
  useEffect(
    () =>
      window.api.onUpdateError((error) =>
        pushToast(store, {
          key: 'update-error',
          tone: 'danger',
          testid: 'update-error',
          message: { key: 'update.failed', values: { error } },
        }),
      ),
    [store],
  )
  useEffect(
    () =>
      window.api.onUpdateCheckFailed((status) => {
        const id = pushToast(store, {
          key: 'update-check',
          tone: 'danger',
          testid: 'update-check-failed',
          message: status
            ? { key: 'update.checkFailedStatus', values: { status } }
            : { key: 'update.checkFailed' },
          action: {
            label: { key: 'update.retry' },
            onAction: () => {
              dismissToast(store, id)
              window.api.checkForUpdates()
            },
          },
        })
      }),
    [store],
  )
}
