import type { BrowserWindow } from 'electron'
import type { WantedCue } from '../shared/cueRules'
import type { DropInput } from '../shared/dropDetect'
import type { GridFit } from '../shared/gridEdit'
import type { FineWave, SurcoGrid, TrackCues } from '../shared/types'
import type { RekordboxQueue } from './rekordboxQueue'
import type { CuesOp, QueueOp } from './rekordboxQueueOps'

export type CueQueue = Pick<RekordboxQueue, 'cuesOp' | 'drop'> & {
  enqueue: (ops: QueueOp[]) => void
}

export interface CueReader {
  trackCues(contentId: string): Promise<TrackCues | null>
  waveDetail(contentId: string): Promise<Uint16Array | null>
  fineWave(contentId: string): Promise<FineWave | null>
  dropInput(contentId: string): Promise<DropInput | null>
  auditionLead(contentId: string): Promise<number>
  surcoGrid(contentId: string): Promise<SurcoGrid | null>
  gridFit(contentId: string, priority: 'high' | 'low'): Promise<GridFit | null>
}

export interface CueSource extends CueReader {
  queuedWanted(contentId: string, op: CuesOp): Promise<WantedCue[]>
  queue: CueQueue
  applyQuietly: (win: BrowserWindow | null) => void
}
