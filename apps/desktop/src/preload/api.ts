// The single definition of the renderer-facing bridge. The implementation in
// index.ts is declared `const api: Api`, so a wrapper whose signature drifts from
// this contract fails the main-side build instead of surfacing as a runtime IPC
// mismatch — and the renderer (via index.d.ts) reads the very same shape.
import type {
  ActivityEvent,
  AppleMusicAddJob,
  AppleMusicLookupCandidate,
  AppleMusicUpdateJob,
  BpmResult,
  CoverExportJob,
  CoverRead,
  DockIconFrames,
  EngineExportTrack,
  KeyResult,
  LoudnessResult,
  MetaRead,
  ProcessJob,
  ProcessProgress,
  ProcessResult,
  Release,
  SearchHints,
  SearchPriority,
  SearchProviderId,
  SearchResult,
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
  onFoldersChanged: (cb: (root: string, files: string[]) => void) => () => void
  unwatchFolders: () => Promise<void>
  // The reopen-last-session pair: get returns the paths saved when the app last ran
  // (already filtered to files that still exist); save records the current list.
  getLastSession: () => Promise<string[]>
  saveLastSession: (paths: string[]) => Promise<void>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  getConfigDir: () => Promise<string | null>
  // The app-default settings location, shown in the field when no custom folder is set.
  defaultConfigDir: () => Promise<string>
  setConfigDir: (dir: string | null) => Promise<Settings>
  cacheStats: () => Promise<{ files: number; bytes: number }>
  clearCache: () => Promise<void>
  pickConfigDir: () => Promise<string | null>
  pickFiles: () => Promise<string[]>
  pickOutputDir: () => Promise<string | null>
  pickEngineLibraryDir: () => Promise<string | null>
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
  // The Engine DJ library's rows in the same candidate shape, for the same membership
  // check when Engine DJ is the conversion destination. Empty when no library exists.
  loadEngineLibrary: () => Promise<AppleMusicLookupCandidate[]>
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
  exportM3u: (m3u: string) => Promise<string | null>
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
  spectrogram: (path: string, priority?: 'high' | 'low') => Promise<SpectrumResult>
  loudness: (path: string) => Promise<LoudnessResult | null>
  properties: (path: string) => Promise<TrackProperties | null>
  bpm: (path: string) => Promise<BpmResult | null>
  key: (path: string) => Promise<KeyResult | null>
  waveform: (path: string) => Promise<WaveformResult | null>
  readTags: (path: string) => Promise<TrackMetadata>
  readDuration: (path: string) => Promise<number | null>
  // Tags, duration and cover from a single round-trip, for the import path.
  readMeta: (path: string) => Promise<MetaRead>
  readCover: (path: string) => Promise<CoverRead | null>
  // The file's embedded art at its original resolution, for the cover lightbox.
  readCoverFull: (path: string) => Promise<string | null>
  onMenuCommand: (cb: (id: string) => void) => () => void
  onProcessProgress: (cb: (progress: ProcessProgress) => void) => () => void
  // Background-work feed for the activity panel: each Discogs/Bandcamp search,
  // cover download and conversion reports start/done/error as it happens.
  onActivity: (cb: (event: ActivityEvent) => void) => () => void
  installUpdate: () => Promise<void>
  onUpdateDownloaded: (cb: (version: string) => void) => () => void
  onUpdateError: (cb: (message: string) => void) => () => void
  onWindowFocus: (cb: (focused: boolean) => void) => () => void
  // The Dock playing animation (macOS only): the renderer rasterizes the icon
  // frames — main has no DOM to render the SVG — and reports play/pause.
  setDockFrames: (frames: DockIconFrames) => void
  setDockPlaying: (playing: boolean) => void
}
