import type { ProcessStage, SpectrumResult, TrackMetadata } from '../../shared/types'

export type TrackStatus = 'idle' | 'processing' | 'done' | 'error'

export interface TrackItem {
  id: string
  inputPath: string
  fileName: string
  query: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  spectrum?: SpectrumResult
  outputName?: string
  status: TrackStatus
  stage?: ProcessStage
  outputPath?: string
  // Snapshot of the editor (via trackSignature) taken when the track last
  // finished, so later edits flip it "stale" and bring back the convert button.
  processedSignature?: string
  error?: string
  // Tracks a manual "add to Apple Music" run, independent of status so the track
  // stays 'done' while it adds. 'error' carries the reason in musicError.
  musicStatus?: 'adding' | 'added' | 'error'
  musicError?: string
}
