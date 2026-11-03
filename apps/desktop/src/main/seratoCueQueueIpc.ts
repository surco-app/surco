import { ipcMain } from 'electron'
import { serialLibraryFlush } from './libraryTagSync'
import type { RekordboxQueue } from './rekordboxQueue'
import { appliedNotice } from './rekordboxQueueIpc'
import { stillWaiting } from './rekordboxQueueWatch'

export function registerSeratoCueQueueIpc(
  queue: Pick<RekordboxQueue, 'state' | 'discard' | 'apply'>,
  host: {
    isRunning: () => Promise<boolean>
    onWaiting?: () => void
    onReady?: () => void
  },
): void {
  ipcMain.handle('serato:cueQueue', () => queue.state())
  ipcMain.handle('serato:applyCueQueue', () =>
    serialLibraryFlush(async () => {
      const result = await queue.apply(async () => !(await host.isRunning()), { manual: true })
      if (stillWaiting(result)) host.onWaiting?.()
      return appliedNotice(result)
    }),
  )
  ipcMain.handle('serato:discardCueQueue', () => queue.discard())
  ipcMain.handle('serato:cueQueueReady', () => host.onReady?.())
}
