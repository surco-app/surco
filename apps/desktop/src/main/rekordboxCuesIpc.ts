import { randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { ipcMain } from 'electron'
import type { CueFlow } from '../shared/cueFlows'
import { isEngineContent } from '../shared/engineContent'
import type { QueuedCues, SaveCuesOutcome, SaveCuesRequest } from '../shared/types'
import { readEngineTrackCues } from './engineCues'
import { engineDropInput } from './engineDropInput'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { learnFromCollection } from './rekordboxLearnFlow'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import { queuedWanted } from './rekordboxPlaylistWrite'
import type { RekordboxQueue } from './rekordboxQueue'

type CueQueue = Pick<RekordboxQueue, 'enqueue' | 'cuesOp' | 'drop'>

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: CueQueue
  applyQuietly: () => void
  flow: () => CueFlow
  engine?: {
    libraryDir: () => string
    queue: CueQueue
    applyQuietly: () => void
    words: (file: string) => Promise<Uint16Array | null>
  }
}): void {
  const engineOf = (contentId: string) => (isEngineContent(contentId) ? host.engine : undefined)
  const queueOf = (contentId: string) => engineOf(contentId)?.queue ?? host.queue
  ipcMain.handle('rekordbox:trackCues', async (_e, contentId: string) => {
    const engine = engineOf(contentId)
    if (engine)
      return withEngineLibrary(
        engine.libraryDir(),
        (db) => readEngineTrackCues(db, contentId),
        null,
      )
    const path = host.collection()
    return withCollection(
      path,
      (db) => readTrackCues(db, rekordboxShareDir(path), contentId),
      null,
      await keyOf(path),
    )
  })
  ipcMain.handle('rekordbox:cueWaveDetail', async (_e, contentId: string) => {
    if (engineOf(contentId)) return null
    const path = host.collection()
    return withCollection(
      path,
      (db) => readCueWaveDetail(db, rekordboxShareDir(path), contentId),
      null,
      await keyOf(path),
    )
  })
  ipcMain.handle('rekordbox:cueDropInput', async (_e, contentId: string) => {
    const engine = engineOf(contentId)
    if (!engine) return null
    const path = host.collection()
    return engineDropInput(contentId, {
      libraryDir: engine.libraryDir(),
      collection: path,
      key: await keyOf(path),
      realPath: (p) => realpathSync(p),
      words: engine.words,
    })
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
      const op = queueOf(contentId).cuesOp(contentId)
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
    const queue = queueOf(contentId)
    const op = queue.cuesOp(contentId)
    if (op) queue.drop(op.id)
  })
  ipcMain.handle('rekordbox:saveCues', (_e, reqs: SaveCuesRequest[]): SaveCuesOutcome => {
    const targets = [
      { ...host, mine: reqs.filter((r) => !engineOf(r.contentId)) },
      ...(host.engine ? [{ ...host.engine, mine: reqs.filter((r) => engineOf(r.contentId)) }] : []),
    ].filter((t) => t.mine.length > 0)
    let outcome: SaveCuesOutcome = 'queued'
    for (const t of targets) {
      if (t.queue.enqueue(t.mine.map((req) => ({ ...req, id: randomUUID(), kind: 'cues' }))))
        t.applyQuietly()
      else outcome = 'other-collection'
    }
    return outcome
  })
}
