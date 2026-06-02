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
  error?: string
}
