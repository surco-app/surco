import type { TrackMetadata, SpectrumResult } from '../../shared/types'

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
  outputPath?: string
  error?: string
}
