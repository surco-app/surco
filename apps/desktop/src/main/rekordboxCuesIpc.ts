import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { SaveCuesRequest } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { readTrackCues } from './rekordboxCues'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import type { RekordboxQueue } from './rekordboxQueue'

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'drop'>
  applyQuietly: () => void
}): void {
  ipcMain.handle('rekordbox:trackCues', async (_e, contentId: string) => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => readTrackCues(db, rekordboxShareDir(path), contentId),
      null,
      await keyOf(path),
    )
  })
  ipcMain.handle('rekordbox:countCompletable', () => {
    const path = host.collection()
    return withCollection(path, (db) => completableOps(db, rekordboxShareDir(path)).length, 0)
  })
  ipcMain.handle(
    'rekordbox:queuedCues',
    (_e, contentId: string) => host.queue.cuesOp(contentId)?.drops ?? null,
  )
  ipcMain.handle('rekordbox:undoCues', (_e, contentId: string) => {
    const op = host.queue.cuesOp(contentId)
    if (op) host.queue.drop(op.id)
  })
  ipcMain.handle('rekordbox:saveCues', (_e, req: SaveCuesRequest) => {
    host.queue.enqueue([{ ...req, id: randomUUID(), kind: 'cues' }])
    host.applyQuietly()
  })
}
