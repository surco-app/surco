import type {
  AppleMusicAddJob,
  CoverExportJob,
  DiscogsRelease,
  DiscogsSearchResult,
  LoudnessResult,
  ProcessJob,
  ProcessProgress,
  ProcessResult,
  SearchPriority,
  SearchProviderId,
  Settings,
  SpectrumResult,
  TrackMetadata,
  TrackProperties,
} from '../shared/types'

export interface Api {
  platform: NodeJS.Platform
  version: string
  getPathForFile: (file: File) => string
  expandPaths: (paths: string[]) => Promise<string[]>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  pickFiles: () => Promise<string[]>
  pickOutputDir: () => Promise<string | null>
  searchDiscogs: (
    query: string,
    provider?: SearchProviderId,
    priority?: SearchPriority,
  ) => Promise<DiscogsSearchResult[]>
  getRelease: (
    id: number,
    provider?: SearchProviderId,
    priority?: SearchPriority,
  ) => Promise<DiscogsRelease>
  lookupAppleMusic: (artist: string, title: string) => Promise<boolean>
  addToAppleMusic: (job: AppleMusicAddJob) => Promise<void>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  exportCover: (job: CoverExportJob) => Promise<string | null>
  prepareCoverDrag: (src: { coverUrl?: string; coverPath?: string }) => Promise<string | null>
  startCoverDrag: (path: string) => void
  reveal: (path: string) => Promise<void>
  openFile: (path: string) => Promise<string>
  trashFile: (path: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  spectrogram: (path: string) => Promise<SpectrumResult>
  loudness: (path: string) => Promise<LoudnessResult | null>
  properties: (path: string) => Promise<TrackProperties | null>
  readTags: (path: string) => Promise<TrackMetadata>
  readDuration: (path: string) => Promise<number | null>
  readCover: (path: string) => Promise<string | null>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onProcessProgress: (cb: (progress: ProcessProgress) => void) => () => void
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (cb: (version: string) => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
