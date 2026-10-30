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
  // How an apply by hand went and a discarded queue, for the tracks held pending on it.
  onSettled?: (result: QueueApply | 'threw') => void
  onDiscarded?: () => void
}

export function registerRekordboxQueueIpc(queue: RekordboxQueue, host: QueueIpcHost): void {
  ipcMain.handle('rekordbox:queue', () => queue.state())
  ipcMain.handle('rekordbox:applyNow', (e) =>
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
  ipcMain.handle('rekordbox:discardQueue', () => {
    queue.discard()
    host.onDiscarded?.()
  })
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
