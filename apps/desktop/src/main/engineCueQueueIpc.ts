import { BrowserWindow, ipcMain } from 'electron'
import type { CopyReason } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import type { RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function registerEngineCueQueueIpc(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
    beginMoment?: (reason: CopyReason) => void
  },
): void {
  ipcMain.handle('engine:cueQueue', () => queue.state())
  ipcMain.handle('engine:applyCueQueue', (e) =>
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
  ipcMain.handle('engine:discardCueQueue', () => queue.discard())
  ipcMain.handle('engine:cueQueueReady', () => host.onReady?.())
}
