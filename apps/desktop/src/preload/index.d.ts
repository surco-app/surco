import type {
  AppleMusicAddJob,
  DiscogsRelease,
  DiscogsSearchResult,
  ProcessJob,
  ProcessResult,
  SearchProviderId,
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
  searchDiscogs: (query: string, provider?: SearchProviderId) => Promise<DiscogsSearchResult[]>
  getRelease: (id: number, provider?: SearchProviderId) => Promise<DiscogsRelease>
  addToAppleMusic: (job: AppleMusicAddJob) => Promise<void>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  reveal: (path: string) => Promise<void>
  spectrogram: (path: string) => Promise<SpectrumResult>
  readTags: (path: string) => Promise<TrackMetadata>
  readCover: (path: string) => Promise<string | null>
  onMenuCommand: (cb: (id: string) => void) => () => void
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (cb: (version: string) => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
