import { BrowserWindow } from 'electron'
import type { DjCueQueueMain } from '../shared/djApi'
import type { CopyReason, RekordboxQueueApplied } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { stillWaiting } from './rekordboxQueueWatch'

export function appliedNotice(result: QueueApply): RekordboxQueueApplied | null {
  if (result.status === 'empty') return null
  if (result.status === 'refused')
    return result.reason === 'cancelled' || result.reason === 'rekordbox-running'
      ? null
      : { refused: result.reason }
  const created = result.outcomes.flatMap((o) =>
    o.applied && o.createdId ? [{ opId: o.id, createdId: o.createdId }] : [],
  )
  return {
    tracks: result.tracks,
    changes: result.changes,
    notices: result.notices,
    written: result.written,
    ...(created.length > 0 && { created }),
  }
}

export interface QueueIpcHost {
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  onWaiting?: () => void
  onReady?: () => void
  beginMoment?: (reason: CopyReason) => void
  // How an apply by hand went and a discarded queue, for the tracks held pending on it.
  onSettled?: (result: QueueApply | 'threw') => void
  onDiscarded?: () => void
}

export function rekordboxQueueSection(queue: RekordboxQueue, host: QueueIpcHost): DjCueQueueMain {
  return {
    read: () => queue.state(),
    apply: (sender) =>
      serialLibraryFlush(async () => {
        host.beginMoment?.('queue')
        let result: QueueApply
        try {
          result = await queue.apply(
            () => host.ensureClosed(BrowserWindow.fromWebContents(sender)),
            { manual: true },
          )
        } catch (err) {
          host.onSettled?.('threw')
          throw err
        }
        host.onSettled?.(result)
        if (stillWaiting(result)) host.onWaiting?.()
        return appliedNotice(result)
      }),
    discard: async () => {
      queue.discard()
      host.onDiscarded?.()
    },
    ready: () => host.onReady?.(),
  }
}
