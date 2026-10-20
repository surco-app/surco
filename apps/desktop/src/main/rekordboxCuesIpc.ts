import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { CueFlow } from '../shared/cueFlows'
import type { QueuedCues, SaveCuesRequest } from '../shared/types'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { learnFromCollection } from './rekordboxLearnFlow'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import { queuedWanted } from './rekordboxPlaylistWrite'
import type { RekordboxQueue } from './rekordboxQueue'

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'drop'>
  applyQuietly: () => void
  flow: () => CueFlow
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
  ipcMain.handle('rekordbox:cueWaveDetail', async (_e, contentId: string) => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => readCueWaveDetail(db, rekordboxShareDir(path), contentId),
      null,
      await keyOf(path),
    )
  })
  ipcMain.handle('rekordbox:countCompletable', () => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => completableOps(db, rekordboxShareDir(path), host.flow()).length,
      0,
    )
  })
  ipcMain.handle('rekordbox:learnFlow', async () => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => learnFromCollection(db, rekordboxShareDir(path)),
      null,
      await keyOf(path),
    )
  })
  ipcMain.handle(
    'rekordbox:queuedCues',
    async (_e, contentId: string): Promise<QueuedCues | null> => {
      const op = host.queue.cuesOp(contentId)
      if (!op || (op.wanted === undefined && op.drops === undefined)) return null
      if (op.wanted) return { wanted: op.wanted, fingerprint: op.fingerprint }
      const path = host.collection()
      const read = withCollection(
        path,
        (db) => readTrackCues(db, rekordboxShareDir(path), contentId, { wave: false }),
        null,
        await keyOf(path),
      )
      const wanted = read ? (queuedWanted(op, read) ?? read.cues) : []
      return { wanted, fingerprint: op.fingerprint }
    },
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
