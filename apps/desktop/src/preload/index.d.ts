import type {
  DiscogsRelease,
  DiscogsSearchResult,
  ProcessJob,
  ProcessResult,
  Settings,
  SpectrumResult,
  TrackMetadata,
} from '../shared/types'

export interface Api {
  platform: NodeJS.Platform
  version: string
  getPathForFile: (file: File) => string
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  pickFiles: () => Promise<string[]>
  pickOutputDir: () => Promise<string | null>
  searchDiscogs: (query: string) => Promise<DiscogsSearchResult[]>
  getRelease: (id: number) => Promise<DiscogsRelease>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  reveal: (path: string) => Promise<void>
  spectrogram: (path: string) => Promise<SpectrumResult>
  readTags: (path: string) => Promise<TrackMetadata>
  readCover: (path: string) => Promise<string | null>
  onMenuCommand: (cb: (id: string) => void) => () => void
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (cb: (version: string) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
