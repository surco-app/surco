import { randomUUID } from 'node:crypto'
import { BrowserWindow, ipcMain } from 'electron'
import type { CueFlow } from '../shared/cueFlows'
import {
  CUE_PROGRAMS,
  type CueProgram,
  isWritable,
  PROGRAM_CAN,
  programOf,
} from '../shared/djProgram'
import type { DropInput } from '../shared/dropDetect'
import type { GridFit } from '../shared/gridEdit'
import type { GridVerdict } from '../shared/gridVerdict'
import type {
  CopyReason,
  FineWave,
  LibraryTracks,
  QueuedCues,
  SaveCuesRequest,
  SurcoGrid,
  TrackCues,
  WritableProgram,
} from '../shared/types'
import type { CueSource } from './cueSource'
import { rekordboxShareDir } from './rekordboxArtwork'
import { completableOps } from './rekordboxCompleteOnClose'
import { withCollection } from './rekordboxPlaylistsIpc'
import type { ProvisionalList } from './rekordboxProvisional'

export function registerCuesIpc(host: {
  collection: () => string
  beginMoment?: (reason: CopyReason, programs: WritableProgram[]) => void
  flow: () => CueFlow
  provisional: Pick<ProvisionalList, 'add'>
  // The same file in each program the editor writes cues to, for a flow to reach them all.
  twins: (file: string) => Promise<LibraryTracks>
  sources: Record<CueProgram, CueSource | null>
}): void {
  const sourceOf = (contentId: string) => host.sources[programOf(contentId)]
  const queueOf = (contentId: string) => sourceOf(contentId)?.queue ?? null
  ipcMain.handle('cues:trackCues', async (_e, contentId: string): Promise<TrackCues | null> => {
    const source = sourceOf(contentId)
    return source ? source.trackCues(contentId) : null
  })
  ipcMain.handle('cues:waveDetail', async (_e, contentId: string): Promise<Uint16Array | null> => {
    const source = sourceOf(contentId)
    return source ? source.waveDetail(contentId) : null
  })
  ipcMain.handle('cues:waveFine', async (_e, contentId: string): Promise<FineWave | null> => {
    const source = sourceOf(contentId)
    return source ? source.fineWave(contentId) : null
  })
  ipcMain.handle('cues:dropInput', async (_e, contentId: string): Promise<DropInput | null> => {
    const source = sourceOf(contentId)
    return source ? source.dropInput(contentId) : null
  })
  ipcMain.handle('cues:twins', (_e, file: string) => host.twins(file))
  ipcMain.handle('cues:auditionLead', async (_e, contentId: string): Promise<number> => {
    const source = sourceOf(contentId)
    return source ? source.auditionLead(contentId) : 0
  })
  ipcMain.handle('cues:surcoGrid', async (_e, contentId: string): Promise<SurcoGrid | null> => {
    const source = sourceOf(contentId)
    return source ? source.surcoGrid(contentId) : null
  })
  ipcMain.handle('cues:gridVerdict', async (_e, contentId: string): Promise<GridVerdict | null> => {
    const source = sourceOf(contentId)
    return source ? source.gridVerdict(contentId) : null
  })
  ipcMain.handle('cues:gridFit', async (_e, contentId: string): Promise<GridFit | null> => {
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
  ipcMain.handle('cues:queued', async (_e, contentId: string): Promise<QueuedCues | null> => {
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
  })
  ipcMain.handle('cues:undo', (_e, contentId: string) => {
    const queue = queueOf(contentId)
    const op = queue?.cuesOp(contentId)
    if (queue && op) queue.drop(op.id)
  })
  ipcMain.handle('cues:save', async (e, reqs: SaveCuesRequest[]) => {
    for (const req of reqs) {
      const program = programOf(req.contentId)
      if (!host.sources[program]) throw new Error(`${program} has no cue source`)
      if (!PROGRAM_CAN[program].saveCues) throw new Error(`${program} cues are read only`)
    }
    const targets = CUE_PROGRAMS.flatMap((program) => {
      const target = host.sources[program]
      const mine = reqs.filter((r) => programOf(r.contentId) === program)
      return target && mine.length > 0 ? [{ ...target, program, mine }] : []
    })
    const withLibrary = targets.map((t) => t.program).filter(isWritable)
    if (withLibrary.length > 0) host.beginMoment?.('cues', withLibrary)
    for (const t of targets) {
      t.queue.enqueue(t.mine.map((req) => ({ ...req, id: randomUUID(), kind: 'cues' })))
      for (const req of t.mine)
        if (req.provisional)
          host.provisional.add({ contentId: req.contentId, label: req.label, wanted: req.wanted })
      t.applyQuietly(BrowserWindow.fromWebContents(e.sender))
    }
  })
}
