import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { BrowserWindow, ipcMain } from 'electron'
import type { CueFlow } from '../shared/cueFlows'
import { isEngineContent } from '../shared/engineContent'
import { isTraktorContent, traktorKey } from '../shared/traktorContent'
import type {
  CopyReason,
  LibraryTracks,
  QueuedCues,
  SaveCuesRequest,
  SurcoGrid,
} from '../shared/types'
import { type BeatGridFit, provisionalGrid } from './beatGrid'
import { readEngineTrackCues } from './engineCues'
import { engineDropInput } from './engineDropInput'
import { withEngineLibrary } from './enginePlaylistsIpc'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { readCueWaveDetail, readTrackCues } from './rekordboxCues'
import { keyOf, withCollection } from './rekordboxPlaylistsIpc'
import { queuedWanted } from './rekordboxPlaylistWrite'
import type { ProvisionalList } from './rekordboxProvisional'
import type { RekordboxQueue } from './rekordboxQueue'
import type { QueueOp } from './rekordboxQueueOps'
import { rekordboxLeadOfFile, rekordboxShiftOfFile } from './rekordboxTimeline'
import { readTraktorTrackCues, traktorEntryBlock } from './traktorCues'
import { traktorDropInput } from './traktorDropInput'
import { traktorFileOf } from './traktorPlaylists'

type CueQueue = Pick<RekordboxQueue, 'cuesOp' | 'drop'> & { enqueue: (ops: QueueOp[]) => void }

const WORDS_PER_SECOND = 150

function shiftedWords(words: Uint16Array, shiftMs: number): Uint16Array {
  const lead = Math.round((shiftMs * WORDS_PER_SECOND) / 1000)
  const out = new Uint16Array(lead + words.length)
  out.set(words, lead)
  return out
}

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: CueQueue
  applyQuietly: () => void
  beginMoment?: (reason: CopyReason) => void
  flow: () => CueFlow
  beatGrid: (file: string) => Promise<BeatGridFit | null>
  words: (file: string) => Promise<Uint16Array | null>
  provisional: Pick<ProvisionalList, 'add'>
  // The same file in each program the editor writes cues to, for a flow to reach them all.
  twins: (file: string) => Promise<LibraryTracks>
  engine?: {
    libraryDir: () => string
    queue: CueQueue
    applyQuietly: () => void
    words: (file: string) => Promise<Uint16Array | null>
  }
  traktor?: {
    nml: () => string
    bootVolume: () => string
    queue: CueQueue
    // Asks to close Traktor over the window that saved: Traktor reads its collection only
    // when it starts, so a save left waiting quietly would not show until it restarts.
    applyQuietly: (win: BrowserWindow | null) => void
    words: (file: string) => Promise<Uint16Array | null>
  }
}): void {
  const engineOf = (contentId: string) => (isEngineContent(contentId) ? host.engine : undefined)
  const traktorOf = (contentId: string) => (isTraktorContent(contentId) ? host.traktor : undefined)
  const queueOf = (contentId: string) =>
    engineOf(contentId)?.queue ?? traktorOf(contentId)?.queue ?? host.queue
  const nmlOf = (traktor: NonNullable<typeof host.traktor>): string => {
    const path = traktor.nml()
    return path ? readFileSync(path, 'utf8') : ''
  }
  const traktorFile = (traktor: NonNullable<typeof host.traktor>, contentId: string) => {
    const entry = traktorEntryBlock(nmlOf(traktor), traktorKey(contentId) ?? '')
    return entry ? traktorFileOf(entry.block, traktor.bootVolume()) : null
  }
  ipcMain.handle('rekordbox:trackCues', async (_e, contentId: string) => {
    const traktor = traktorOf(contentId)
    if (traktor) return readTraktorTrackCues(nmlOf(traktor), contentId)
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
    const traktor = traktorOf(contentId)
    if (traktor) {
      const file = traktorFile(traktor, contentId)
      return file ? traktor.words(file) : null
    }
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
    const traktor = traktorOf(contentId)
    if (traktor) {
      const path = host.collection()
      return traktorDropInput(contentId, {
        nml: nmlOf(traktor),
        bootVolume: traktor.bootVolume(),
        collection: path,
        key: path ? await keyOf(path) : undefined,
        realPath: (p) => realpathSync(p),
        words: traktor.words,
      })
    }
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
  ipcMain.handle('rekordbox:cueTwins', (_e, file: string) => host.twins(file))
  ipcMain.handle('rekordbox:auditionLead', async (_e, contentId: string) => {
    const path = host.collection()
    const file = withCollection(
      path,
      (db) =>
        (
          db
            .prepare(
              `SELECT FolderPath FROM djmdContent WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
            )
            .get(contentId) as { FolderPath: string } | undefined
        )?.FolderPath ?? null,
      null,
      await keyOf(path),
    )
    return file ? rekordboxLeadOfFile(file) : 0
  })
  ipcMain.handle(
    'rekordbox:surcoGrid',
    async (_e, contentId: string): Promise<SurcoGrid | null> => {
      if (engineOf(contentId) || traktorOf(contentId)) return null
      const path = host.collection()
      const row = withCollection(
        path,
        (db) =>
          db
            .prepare(
              `SELECT FolderPath, SampleRate, Length FROM djmdContent
                WHERE ID = ? AND coalesce(rb_local_deleted, 0) = 0`,
            )
            .get(contentId) as
            | { FolderPath: string; SampleRate: number | null; Length: number }
            | undefined,
        undefined,
        await keyOf(path),
      )
      if (!row) return null
      const fit = await host.beatGrid(row.FolderPath)
      if (!fit) return null
      const shiftMs = await rekordboxShiftOfFile(row.FolderPath, row.SampleRate || 44100)
      const words = await host.words(row.FolderPath)
      return {
        bpm: fit.bpm,
        grid: provisionalGrid(fit, shiftMs, row.Length * 1000),
        words: words && shiftedWords(words, shiftMs),
      }
    },
  )
  ipcMain.handle('rekordbox:countCompletable', () => {
    const path = host.collection()
    return withCollection(
      path,
      (db) => completableOps(db, rekordboxShareDir(path), host.flow()).length,
      0,
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
  ipcMain.handle('rekordbox:saveCues', (e, reqs: SaveCuesRequest[]) => {
    const targets = [
      {
        ...host,
        mine: reqs.filter((r) => !engineOf(r.contentId) && !traktorOf(r.contentId)),
      },
      ...(host.engine
        ? [
            {
              ...host.engine,
              mine: reqs.filter((r) => engineOf(r.contentId)),
            },
          ]
        : []),
      ...(host.traktor
        ? [
            {
              ...host.traktor,
              mine: reqs.filter((r) => traktorOf(r.contentId)),
            },
          ]
        : []),
    ].filter((t) => t.mine.length > 0)
    if (targets.length > 0) host.beginMoment?.('cues')
    for (const t of targets) {
      t.queue.enqueue(t.mine.map((req) => ({ ...req, id: randomUUID(), kind: 'cues' })))
      for (const req of t.mine)
        if (req.provisional)
          host.provisional.add({ contentId: req.contentId, label: req.label, wanted: req.wanted })
      t.applyQuietly(BrowserWindow.fromWebContents(e.sender))
    }
  })
}
