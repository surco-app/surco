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
  EngineExportTrack,
  Release,
  SearchResult,
  DockIconFrames,
  KeyResult,
  LoudnessResult,
  ProcessJob,
  ProcessProgress,
  ProcessResult,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  Settings,
  SpectrumResult,
  TrackMetadata,
  TrackProperties,
  WaveformResult,
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
  // The app-default settings location, shown in the field when no custom folder is set.
  defaultConfigDir: () => Promise<string>
  setConfigDir: (dir: string | null) => Promise<Settings>
  pickConfigDir: () => Promise<string | null>
  pickFiles: () => Promise<string[]>
  pickOutputDir: () => Promise<string | null>
  search: (
    query: string,
    provider?: SearchProviderId,
    priority?: SearchPriority,
    hints?: SearchHints,
  ) => Promise<SearchResult[]>
  getRelease: (
    ref: number | string,
    provider?: SearchProviderId,
    priority?: SearchPriority,
  ) => Promise<Release>
  // The whole Apple Music library as title/artist pairs, matched against the crate in
  // the renderer to flag already-owned tracks. Empty off macOS.
  loadAppleMusicLibrary: () => Promise<AppleMusicLookupCandidate[]>
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
  exportSerato: (data: Uint8Array) => Promise<string | null>
  exportEngine: (tracks: EngineExportTrack[], playlistName: string) => Promise<string | null>
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
  // Resolves the candidate URLs of an image dragged from a browser to the first that is
  // a real image, as a data-URL preview (CSP-safe) plus, for downloaded ones, a local
  // path. Null when none resolve.
  resolveDraggedCover: (urls: string[]) => Promise<{ coverUrl: string; coverPath?: string } | null>
  hasClipboardImage: () => Promise<boolean>
  startCoverDrag: (path: string) => void
  startTrackDrag: (paths: string[], coverUrl?: string) => void
  reveal: (path: string) => Promise<void>
  openFile: (path: string) => Promise<string>
  trashFile: (path: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  spectrogram: (path: string) => Promise<SpectrumResult>
  loudness: (path: string) => Promise<LoudnessResult | null>
  properties: (path: string) => Promise<TrackProperties | null>
  bpm: (path: string) => Promise<BpmResult | null>
  key: (path: string) => Promise<KeyResult | null>
  waveform: (path: string) => Promise<WaveformResult | null>
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
