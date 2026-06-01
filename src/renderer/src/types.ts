import type { TrackMetadata } from '../../shared/types'

export type TrackStatus = 'idle' | 'processing' | 'done' | 'error'

export interface TrackItem {
  id: string
  inputPath: string
  fileName: string
  query: string
  meta: TrackMetadata
  coverUrl?: string
  coverPath?: string
  status: TrackStatus
  outputPath?: string
  error?: string
}
