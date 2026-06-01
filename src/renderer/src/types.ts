import type { TrackMetadata, SpectrumResult, ProcessStage } from '../../shared/types'

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
  status: TrackStatus
  stage?: ProcessStage
  outputPath?: string
  error?: string
}
