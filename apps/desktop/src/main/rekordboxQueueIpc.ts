import { realpathSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import type { CopyReason, RekordboxQueueApplied } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { readMembership } from './rekordboxMembership'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import type { QueueApply, RekordboxQueue } from './rekordboxQueue'
import { stillWaiting } from './rekordboxQueueWatch'

export function appliedNotice(result: QueueApply): RekordboxQueueApplied | null {
  if (result.status === 'empty') return null
  if (result.status === 'refused')
    return result.reason === 'cancelled' || result.reason === 'rekordbox-running'
      ? null
      : { refused: result.reason }
  return {
    tracks: result.tracks,
    changes: result.changes,
    notices: result.notices,
    written: result.written,
  }
}

export interface QueueIpcHost {
  collection: () => string
  ensureClosed: (win: BrowserWindow | null) => Promise<boolean>
  onWaiting?: () => void
  onReady?: () => void
  beginMoment?: (reason: CopyReason) => void
}

export function registerRekordboxQueueIpc(queue: RekordboxQueue, host: QueueIpcHost): void {
  ipcMain.handle('rekordbox:queue', () => queue.state())
  ipcMain.handle('rekordbox:applyNow', (e) =>
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
  ipcMain.handle('rekordbox:discardQueue', () => queue.discard())
  ipcMain.handle('rekordbox:queueReady', () => host.onReady?.())
  ipcMain.handle('rekordbox:membership', async (_e, paths: string[]) => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => readMembership(db, paths, { realPath: (p: string) => realpathSync(p) }),
      {},
      await keyOf(path),
    )
  })
}
