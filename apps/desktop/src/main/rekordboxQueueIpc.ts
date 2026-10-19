import { realpathSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import type { RekordboxQueueApplied } from '../shared/types'
import { serialLibraryFlush } from './libraryTagSync'
import { readMembership } from './rekordboxMembership'
import { withCollection } from './rekordboxPlaylistsIpc'
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
}

export function registerRekordboxQueueIpc(queue: RekordboxQueue, host: QueueIpcHost): void {
  ipcMain.handle('rekordbox:queue', () => queue.state())
  ipcMain.handle('rekordbox:applyNow', (e) =>
    serialLibraryFlush(async () => {
      const result = await queue.apply(() =>
        host.ensureClosed(BrowserWindow.fromWebContents(e.sender)),
      )
      if (stillWaiting(result)) host.onWaiting?.()
      return appliedNotice(result)
    }),
  )
  ipcMain.handle('rekordbox:discardQueue', () => queue.discard())
  ipcMain.handle('rekordbox:membership', (_e, paths: string[]) =>
    withCollection(
      host.collection(),
      (db) => readMembership(db, paths, { realPath: (p: string) => realpathSync(p) }),
      {},
    ),
  )
}
