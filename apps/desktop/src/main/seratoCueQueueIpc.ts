import type { DjCueQueueMain } from '../shared/djApi'
import { serialLibraryFlush } from './libraryTagSync'
import type { RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function seratoCueQueueSection(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    isRunning: () => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
  },
): DjCueQueueMain {
  return {
    read: () => queue.state(),
    apply: () =>
      serialLibraryFlush(async () => {
        const result = await queue.apply(async () => !(await host.isRunning()), { manual: true })
        if (stillWaiting(result)) host.onWaiting?.()
        return appliedNotice(result)
      }),
    discard: async () => queue.discard(),
    ready: () => host.onReady?.(),
  }
}
