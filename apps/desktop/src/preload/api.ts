// The single definition of the renderer-facing bridge. The implementation in
// index.ts is declared `const api: Api`, so a wrapper whose signature drifts from
// this contract fails the main-side build instead of surfacing as a runtime IPC
// mismatch — and the renderer (via index.d.ts) reads the very same shape.
import type {
  AppleMusicAddJob,
  AppleMusicLookupCandidate,
  AppleMusicUpdateJob,
  BpmResult,
  CoverExportJob,
  CoverRead,
  DiscogsRelease,
  DiscogsSearchResult,
  DockIconFrames,
  KeyResult,
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
  takePendingFiles: () => Promise<string[]>
  onOpenFiles: (cb: (paths: string[]) => void) => () => void
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  getConfigDir: () => Promise<string | null>
  setConfigDir: (dir: string | null) => Promise<Settings>
  pickConfigDir: () => Promise<string | null>
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
  lookupAppleMusic: (candidates: AppleMusicLookupCandidate[]) => Promise<boolean>
  // Both resolve with the persistent ID of the library copy they added or synced
  // (undefined off macOS), the handle the renderer stores to update or reveal that
  // exact copy later.
  addToAppleMusic: (job: AppleMusicAddJob) => Promise<string | undefined>
  updateAppleMusic: (job: AppleMusicUpdateJob) => Promise<string | undefined>
  revealAppleMusic: (persistentId: string) => Promise<void>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  exportCover: (job: CoverExportJob) => Promise<string | null>
  exportRekordbox: (xml: string) => Promise<string | null>
  exportTraktor: (nml: string) => Promise<string | null>
  prepareCoverDrag: (src: {
    coverUrl?: string
    coverPath?: string
    coverFromFile?: string
  }) => Promise<string | null>
  copyCoverImage: (src: {
    coverUrl?: string
    coverPath?: string
    coverFromFile?: string
  }) => Promise<boolean>
  pasteCoverImage: () => Promise<{ coverUrl: string; coverPath: string } | null>
  startCoverDrag: (path: string) => void
  startTrackDrag: (path: string) => void
  reveal: (path: string) => Promise<void>
  openFile: (path: string) => Promise<string>
  trashFile: (path: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  spectrogram: (path: string) => Promise<SpectrumResult>
  loudness: (path: string) => Promise<LoudnessResult | null>
  properties: (path: string) => Promise<TrackProperties | null>
  bpm: (path: string) => Promise<BpmResult | null>
  key: (path: string) => Promise<KeyResult | null>
  readTags: (path: string) => Promise<TrackMetadata>
  readDuration: (path: string) => Promise<number | null>
  readCover: (path: string) => Promise<CoverRead | null>
  // The file's embedded art at its original resolution, for the cover lightbox.
  readCoverFull: (path: string) => Promise<string | null>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onProcessProgress: (cb: (progress: ProcessProgress) => void) => () => void
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (cb: (version: string) => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
  onWindowFocus: (cb: (focused: boolean) => void) => () => void
  // The Dock playing animation (macOS only): the renderer rasterizes the icon
  // frames — main has no DOM to render the SVG — and reports play/pause.
  setDockFrames: (frames: DockIconFrames) => void
  setDockPlaying: (playing: boolean) => void
}
