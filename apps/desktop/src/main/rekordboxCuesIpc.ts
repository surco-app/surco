import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { SaveCuesRequest } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { readTrackCues } from './rekordboxCues'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { RekordboxQueue } from './rekordboxQueue'

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue'>
  applyQuietly: () => void
}): void {
  ipcMain.handle('rekordbox:trackCues', (_e, contentId: string) => {
    const path = host.collection()
    return withCollection(path, (db) => readTrackCues(db, rekordboxShareDir(path), contentId), null)
  })
  ipcMain.handle('rekordbox:saveCues', (_e, req: SaveCuesRequest) => {
    host.queue.enqueue([{ ...req, id: randomUUID(), kind: 'cues' }])
    host.applyQuietly()
  })
}
