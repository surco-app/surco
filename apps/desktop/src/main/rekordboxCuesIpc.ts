import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { CueFlow } from '../shared/cueFlows'
import { programOf, writableInOrder } from '../shared/djProgram'
import type { DropInput } from '../shared/dropDetect'
import type { GridFit } from '../shared/gridEdit'
import type {
  CopyReason,
  DjProgram,
  LibraryTracks,
  QueuedCues,
  SaveCuesRequest,
  SurcoGrid,
  TrackCues,
  WritableProgram,
} from '../shared/types'
import type { BeatGridFit } from './beatGrid'
import type { CueQueue, CueSource } from './cueSource'
import { engineCueSource } from './engineCueSource'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { rekordboxCueSource } from './rekordboxCueSource'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { ProvisionalList } from './rekordboxProvisional'
import { traktorCueSource } from './traktorCueSource'

const CUE_SAVE_ORDER = writableInOrder(['rekordbox', 'engine', 'traktor'])

export function registerRekordboxCuesIpc(host: {
  collection: () => string
  queue: CueQueue
  applyQuietly: () => void
  beginMoment?: (reason: CopyReason, programs: WritableProgram[]) => void
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
  const sources: Record<DjProgram, CueSource | null> = {
    rekordbox: rekordboxCueSource(host),
    traktor: host.traktor ? traktorCueSource(host.traktor, host.collection) : null,
    engine: host.engine ? engineCueSource(host.engine, host.collection) : null,
    serato: null,
  }
  const sourceOf = (contentId: string) => sources[programOf(contentId)]
  const queueOf = (contentId: string) => sourceOf(contentId)?.queue ?? null
  ipcMain.handle(
    'rekordbox:trackCues',
    async (_e, contentId: string): Promise<TrackCues | null> => {
      const source = sourceOf(contentId)
      return source ? source.trackCues(contentId) : null
    },
  )
  ipcMain.handle(
    'rekordbox:cueWaveDetail',
    async (_e, contentId: string): Promise<Uint16Array | null> => {
      const source = sourceOf(contentId)
      return source ? source.waveDetail(contentId) : null
    },
  )
  ipcMain.handle(
    'rekordbox:cueDropInput',
    async (_e, contentId: string): Promise<DropInput | null> => {
      const source = sourceOf(contentId)
      return source ? source.dropInput(contentId) : null
    },
  )
  ipcMain.handle('rekordbox:cueTwins', (_e, file: string) => host.twins(file))
  ipcMain.handle('rekordbox:auditionLead', async (_e, contentId: string): Promise<number> => {
    const source = sourceOf(contentId)
    return source ? source.auditionLead(contentId) : 0
  })
  ipcMain.handle(
    'rekordbox:surcoGrid',
    async (_e, contentId: string): Promise<SurcoGrid | null> => {
      const source = sourceOf(contentId)
      return source ? source.surcoGrid(contentId) : null
    },
  )
  ipcMain.handle('rekordbox:gridFit', async (_e, contentId: string): Promise<GridFit | null> => {
    const source = sourceOf(contentId)
    return source ? source.gridFit(contentId) : null
  })
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
      const source = sourceOf(contentId)
      const op = source?.queue.cuesOp(contentId)
      if (!source || !op || (op.wanted === undefined && op.drops === undefined)) return null
      const grid = op.grid ? { grid: op.grid, gridFingerprint: op.gridFingerprint } : {}
      if (op.wanted) return { wanted: op.wanted, fingerprint: op.fingerprint, ...grid }
      return {
        wanted: await source.queuedWanted(contentId, op),
        fingerprint: op.fingerprint,
        ...grid,
      }
    },
  )
  ipcMain.handle('rekordbox:undoCues', (_e, contentId: string) => {
    const queue = queueOf(contentId)
    const op = queue?.cuesOp(contentId)
    if (queue && op) queue.drop(op.id)
  })
  ipcMain.handle('rekordbox:saveCues', (e, reqs: SaveCuesRequest[]) => {
    const targets = CUE_SAVE_ORDER.flatMap((program) => {
      const target = sources[program]
      const mine = reqs.filter((r) => programOf(r.contentId) === program)
      return target && mine.length > 0 ? [{ ...target, program, mine }] : []
    })
    if (targets.length > 0)
      host.beginMoment?.(
        'cues',
        targets.map((t) => t.program),
      )
    for (const t of targets) {
      t.queue.enqueue(t.mine.map((req) => ({ ...req, id: randomUUID(), kind: 'cues' })))
      for (const req of t.mine)
        if (req.provisional)
          host.provisional.add({ contentId: req.contentId, label: req.label, wanted: req.wanted })
      t.applyQuietly(BrowserWindow.fromWebContents(e.sender))
    }
  })
}
