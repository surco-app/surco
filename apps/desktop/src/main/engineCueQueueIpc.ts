import type { DjCueQueueMain } from '../shared/djApi'
import type { CopyReason } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function engineCueQueueSection(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    isClosed: () => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
    beginMoment?: (reason: CopyReason) => void
    // How an apply by hand went and a discarded queue, for the tracks held pending on it.
    onSettled?: (result: QueueApply | 'threw') => void
    onDiscarded?: () => void
  },
): DjCueQueueMain {
  return {
    read: () => queue.state(),
    apply: () =>
      serialLibraryFlush(async () => {
        host.beginMoment?.('queue')
        let result: QueueApply
        try {
          result = await queue.apply(() => host.isClosed(), { manual: true })
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
