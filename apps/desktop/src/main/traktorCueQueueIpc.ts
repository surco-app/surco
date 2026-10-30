import { BrowserWindow, ipcMain } from 'electron'
import type { CopyReason } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function registerTraktorCueQueueIpc(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
    beginMoment?: (reason: CopyReason) => void
    // How an apply by hand went and a discarded queue, for the tracks held pending on it.
    onSettled?: (result: QueueApply | 'threw') => void
    onDiscarded?: () => void
  },
): void {
  ipcMain.handle('traktor:cueQueue', () => queue.state())
  ipcMain.handle('traktor:applyCueQueue', (e) =>
    serialLibraryFlush(async () => {
      host.beginMoment?.('queue')
      let result: QueueApply
      try {
        result = await queue.apply(
          () => host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
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
  )
  ipcMain.handle('traktor:discardCueQueue', () => {
    queue.discard()
    host.onDiscarded?.()
  })
  ipcMain.handle('traktor:cueQueueReady', () => host.onReady?.())
}
