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
  DeclickMode,
  DockIconFrames,
  KeyResult,
  LifetimeStats,
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
  SessionData,
  SessionEdit,
  Settings,
  SpectrumResult,
  TrackMetadata,
  TrackProperties,
  WaveformResult,
  WaveformScan,
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
  // (already filtered to files that still exist) plus each track's staged edits;
  // save records the current list and edits.
  getLastSession: () => Promise<SessionData>
  saveLastSession: (paths: string[], edits: Record<string, SessionEdit>) => Promise<void>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  // Fire-and-forget bump of one lifetime tally (Stats tab); main validates and persists.
  recordStat: (key: keyof LifetimeStats, by?: number) => void
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
  // Removes a superseded library copy (entry + file to the OS Trash) after a replace.
  // 'missing' means the copy was already gone, which the caller treats as done; the
  // trashed file's path rides back so rows loaded from that same file can be marked.
  // The track label feeds the activity row. Undefined off macOS.
  deleteAppleMusic: (
    persistentId: string,
    track: string,
  ) => Promise<{ outcome: 'deleted' | 'missing'; location?: string } | undefined>
  processTrack: (job: ProcessJob) => Promise<ProcessResult>
  // Marks the start of a convert-all run so main forgets any "apply to the rest"
  // file-conflict choice the previous run left. Fire-and-forget; single converts skip it,
  // so their conflicts always prompt.
  beginConversionBatch: () => void
  // Reaches an encode already in flight for this job id; a no-op if it already
  // finished or never started. Fire-and-forget, mirroring dock:frames/track:drag.
  cancelJob: (jobId: string) => void
  exportCover: (job: CoverExportJob) => Promise<string | null>
  exportRekordbox: (xml: string) => Promise<string | null>
  exportTraktor: (nml: string) => Promise<string | null>
  exportSerato: (tracks: { inputPath: string; outputPath?: string }[]) => Promise<string | null>
  exportM3u: (m3u: string) => Promise<string | null>
  exportSettings: () => Promise<string | null>
  importSettings: () => Promise<
    { ok: true; settings: Settings } | { ok: false; error: string } | null
  >
  exportQualityReport: (dataUrl: string, baseName: string) => Promise<string | null>
  exportStatsImage: (dataUrl: string) => Promise<string | null>
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
  // Fire-and-forget: renderer crashes land in main's log file, the only forensic
  // artifact in an app with no telemetry.
  logError: (message: string, stack?: string) => void
  // Shows the log file in the OS file manager so a user can attach it to a report.
  revealLog: () => Promise<void>
  spectrogram: (path: string, priority?: 'high' | 'low') => Promise<SpectrumResult>
  loudness: (path: string, priority?: 'high' | 'low') => Promise<LoudnessResult | null>
  properties: (path: string) => Promise<TrackProperties | null>
  bpm: (path: string, priority?: 'high' | 'low') => Promise<BpmResult | null>
  key: (path: string, priority?: 'high' | 'low') => Promise<KeyResult | null>
  waveform: (path: string, priority?: 'urgent' | 'high' | 'low') => Promise<WaveformResult | null>
  // The native-rate clip/channel scan for the compare/player strip only (marks + split).
  waveformScan: (path: string) => Promise<WaveformScan | null>
  // A slice of the track re-decoded at full waveform fidelity, for the strips'
  // deep zoom — DAW-style windowed detail past the global envelope's resolution.
  waveformWindow: (
    path: string,
    startSec: number,
    durSec: number,
    buckets: number,
  ) => Promise<{ peaks: number[]; rms: number[] } | null>
  // Renders the whole track through the given repair mode into a temp WAV playable
  // through surco://, for the A/B against the original. Whole track, not an excerpt:
  // the user judges the repair at the clicks they can see, wherever they sit. Slow
  // (tens of seconds on a long side), hence the progress events and the cancel.
  // null when the mode is off, the render failed, or it was cancelled.
  declickPreview: (path: string, mode: DeclickMode) => Promise<{ path: string } | null>
  // Progress (0..1) for the running declickPreview render. Returns an unsubscribe.
  onDeclickPreviewProgress: (fn: (done: number) => void) => () => void
  // Abandons the running declickPreview render — a preset change invalidates it, and
  // the user must never wait on audio they no longer asked for.
  cancelDeclickPreview: () => Promise<void>
  // Aborts the path's in-flight selection-driven ('high') analyses — fired when the
  // user browses away from a track so its decodes stop holding limiter slots the newly
  // selected track then queues behind. Background ('low') analyses are untouched.
  cancelAnalysis: (path: string) => Promise<void>
  // The track's audible clicks (Surco's own event detector): how many, where each one
  // sits in seconds, and how far into the track the detector actually read — past
  // `scannedSec` nothing was analysed, so the wave must not imply a clean tail.
  // null when the analysis failed.
  clicks: (
    path: string,
    priority?: 'high' | 'low',
  ) => Promise<{ count: number; marks: number[]; scannedSec: number } | null>
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
