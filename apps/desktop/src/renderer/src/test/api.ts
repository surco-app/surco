import type { Api } from '../../../preload/api'
import { DEFAULT_EDITOR_SECTIONS } from '../../../shared/editorSections'
import { emptyMetadata } from '../../../shared/metadata'
import type { Settings } from '../../../shared/types'

// A complete, valid Settings for tests that need one. Declared `: Settings` so a field
// added to the type fails here, once, instead of in every test that built its own literal.
export const testSettings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: [],
  outputDir: '/out',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  addToEngineDj: false,
  engineLibraryDir: '/music/Engine Library',
  traktorNmlPath: '',
  engineDjPlaylist: 'Surco',
  filenameFormat: '',
  titleFormat: '',
  autoApplyFilename: false,
  groupingPresets: [],
  genrePresets: [],
  trimWhitespace: true,
  zeroPadTrack: true,
  visibleFields: [],
  requiredFields: [],
  coverMaxSize: 1200,
  coverSquare: false,
  coverUpscale: false,
  replaceLowResCover: false,
  flacFinderCovers: false,
  mp3Quality: '320',
  outputBitDepth: 'source',
  outputSampleRate: 'source',
  flacCompression: '5',
  showSpectrum: true,
  activityPanel: null,
  resultsWidth: null,
  autoAnalyze: false,
  showWaveform: true,
  showLoudness: true,
  showEditorHints: true,
  autoMatch: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: 'off',
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  hasSeenOnboarding: false,
  deezerProviderMigrated: true,
  conversionCount: 0,
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
  },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

// A complete Api whose every method is an inert stub: no side effects, no invented data.
// Tests spread their own behaviour over it — stubApi({ readTags: vi.fn(...) }) — so a test
// states only what it actually exercises, and a method it never mentions cannot surprise
// it with a value it did not ask for.
//
// Typed `: Api`, which is the entire point of this file. Tests reach window.api through
// `as unknown as` casts, and those switch type checking off exactly where the
// main↔renderer contract needs it most: change a method's shape in api.ts and every
// cast-built mock still compiles with the old one, so the suite stays green while the real
// IPC has already diverged. Building the value here means tsc fails the day the contract
// moves — the guarantee api.ts's own comment claims, extended to the renderer's side.
//
// The two throwing stubs are deliberate. getRelease and processTrack have no honest
// "nothing happened" value (Release and ProcessResult are both required shapes), and
// inventing one would let a test that forgot to stub them quietly assert against fiction.
// Throwing names the missing stub instead.
export function stubApi(over: Partial<Api> = {}): Api {
  const noop = (): void => {}
  const unsubscribe = () => noop
  return {
    platform: 'darwin',
    version: '0.0.0-test',
    getPathForFile: () => '',
    expandPaths: async () => [],
    onExpandedBatch: unsubscribe,
    takePendingFiles: async () => [],
    onOpenFiles: unsubscribe,
    onFoldersChanged: unsubscribe,
    unwatchFolders: async () => {},
    getLastSession: async () => ({ paths: [], edits: {} }),
    saveLastSession: async () => {},
    getSettings: async () => testSettings,
    saveSettings: async () => testSettings,
    recordStat: noop,
    getConfigDir: async () => null,
    defaultConfigDir: async () => '',
    setConfigDir: async () => testSettings,
    cacheStats: async () => ({ files: 0, bytes: 0 }),
    clearCache: async () => {},
    pickConfigDir: async () => null,
    pickFiles: async () => [],
    pickOutputDir: async () => null,
    pickEngineLibraryDir: async () => null,
    pickTraktorNmlPath: async () => null,
    detectTraktorNmlPath: async () => null,
    search: async () => [],
    getRelease: async () => {
      throw new Error('stubApi: this test needs its own getRelease')
    },
    loadAppleMusicLibrary: async () => [],
    loadAppleMusicLibraryCached: async () => null,
    loadEngineLibrary: async () => [],
    addToAppleMusic: async () => undefined,
    updateAppleMusic: async () => undefined,
    revealAppleMusic: async () => {},
    deleteAppleMusic: async () => undefined,
    processTrack: async () => {
      throw new Error('stubApi: this test needs its own processTrack')
    },
    releasePlayingFile: async () => {},
    beginConversionBatch: noop,
    endConversionBatch: noop,
    cancelJob: noop,
    exportCover: async () => null,
    exportRekordbox: async () => null,
    exportTraktor: async () => null,
    exportSerato: async () => null,
    exportM3u: async () => null,
    exportSettings: async () => null,
    importSettings: async () => null,
    exportQualityReport: async () => null,
    exportStatsImage: async () => null,
    prepareCoverDrag: async () => null,
    copyCoverImage: async () => false,
    pasteCoverImage: async () => null,
    resolveDraggedCover: async () => null,
    hasClipboardImage: async () => false,
    startCoverDrag: noop,
    startTrackDrag: noop,
    reveal: async () => {},
    openFile: async () => '',
    trashFile: async () => {},
    copyText: async () => {},
    logError: noop,
    revealLog: async () => {},
    openFeedback: async () => {},
    // No null to fall back on (SpectrumResult is a required shape), so the inert value is
    // an empty render: no image, and a null cutoff, which the UI already reads as "no
    // verdict" rather than a good or bad one.
    spectrogram: async () => ({
      image: '',
      cutoffHz: null,
      sampleRateHz: 44100,
      processed: false,
    }),
    loadCachedAnalyses: async () => ({}),
    loudness: async () => null,
    properties: async () => null,
    bpm: async () => null,
    key: async () => null,
    waveform: async () => null,
    waveformScan: async () => null,
    waveformWindow: async () => null,
    declickPreview: async () => null,
    onDeclickPreviewProgress: unsubscribe,
    cancelDeclickPreview: async () => {},
    cancelAnalysis: async () => {},
    clicks: async () => null,
    readTags: async () => emptyMetadata(),
    readDuration: async () => null,
    readMeta: async () => ({
      tags: emptyMetadata(),
      duration: null,
      cover: null,
      foreignTags: [],
    }),
    readCover: async () => null,
    readCoverFull: async () => null,
    onMenuCommand: unsubscribe,
    onProcessProgress: unsubscribe,
    onActivity: unsubscribe,
    installUpdate: async () => {},
    onUpdateDownloaded: unsubscribe,
    onUpdateError: unsubscribe,
    checkForUpdates: async () => {},
    onUpdateCheckFailed: unsubscribe,
    onWindowFocus: unsubscribe,
    setDockFrames: noop,
    setDockPlaying: noop,
    ...over,
  }
}

// Puts a stub on window.api and hands it back. The assignment is unavoidably a cast —
// window.api is declared non-optional, so there is no honest way to replace it — but the
// VALUE comes from stubApi and is therefore fully checked: the cast only moves an
// already-typed object into place, which is the opposite of casting an untyped literal.
export function installApi(over: Partial<Api> = {}): Api {
  const api = stubApi(over)
  ;(globalThis.window as unknown as { api: Api }).api = api
  return api
}
