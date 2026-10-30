import { BrowserWindow, ipcMain } from 'electron'
import type { CopyReason } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import type { RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function registerTraktorCueQueueIpc(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
    beginMoment?: (reason: CopyReason) => void
  },
): void {
  ipcMain.handle('traktor:cueQueue', () => queue.state())
  ipcMain.handle('traktor:applyCueQueue', (e) =>
    serialLibraryFlush(async () => {
      host.beginMoment?.('queue')
      const result = await queue.apply(
        () => host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
        { manual: true },
      )
      if (stillWaiting(result)) host.onWaiting?.()
      return appliedNotice(result)
    }),
  )
  ipcMain.handle('traktor:discardCueQueue', () => queue.discard())
  ipcMain.handle('traktor:cueQueueReady', () => host.onReady?.())
}
