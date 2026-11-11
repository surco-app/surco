import { vi } from 'vitest'
import type { Api, CuesApi } from '../../../preload/api'
import { BUNDLED_FLOWS } from '../../../shared/cueFlows'
import type { DjApi } from '../../../shared/djApi'
import type { DjProgram } from '../../../shared/djProgram'
import { DEFAULT_EDITOR_SECTIONS } from '../../../shared/editorSections'
import { emptyMetadata } from '../../../shared/metadata'
import { DEFAULT_SESSION_WIZARD } from '../../../shared/sessionSettings'
import type {
  PlaylistEditMode,
  CollectionTrack,
  RekordboxEditResult,
  RekordboxPlaylistEdit,
  RekordboxQueueApplied,
  RekordboxQueueState,
  Settings,
  SourceNode,
  SourcePlaylistEntry,
} from '../../../shared/types'

// A complete, valid Settings for tests that need one. Declared `: Settings` so a field
// added to the type fails here, once, instead of in every test that built its own literal.
export const testSettings: Settings = {
  theme: 'system',
  language: 'system',
  discogsToken: '',
  beatportUsername: '',
  beatportPassword: '',
  discogsFormats: [],
  discogsMaxResults: 10,
  searchProviders: ['discogs'],
  searchIgnoreWords: [],
  searchByAlbumFirst: false,
  outputDir: '/out',
  outputFormat: 'aiff',
  keepMp3Sources: false,
  addToAppleMusic: false,
  keepOutputCopy: true,
  overwriteOriginal: false,
  convertBesideOriginal: false,
  backupPolicy: 'always',
  backupRetentionDays: 30,
  backupMaxGb: 10,
  analysisCacheGb: 10,
  addToEngineDj: false,
  addToRekordbox: false,
  addToTraktor: false,
  addToSerato: false,
  engineLibraryDir: '/music/Engine Library',
  traktorNmlPath: '',
  rekordboxDbPath: '',
  syncTraktor: false,
  syncRekordbox: false,
  completeCuesOnClose: false,
  cueFlows: BUNDLED_FLOWS,
  activeCueFlow: 'mix-in',
  cueJumpBars: 16,
  cueQuantize: 'bar',
  cueGridTolerance: 10,
  cueLettersByTime: true,
  cueFlowToRekordbox: true,
  cueFlowToTraktor: true,
  cueFlowToEngine: true,
  cueFlowToSerato: true,
  cueLearnFromEdits: true,
  hiddenSources: [],
  sessionWizard: { ...DEFAULT_SESSION_WIZARD },
  sessionsMade: [],
  rekordboxPlaylistsFieldOffered: false,
  traktorPlaylistsFieldOffered: false,
  enginePlaylistsFieldOffered: false,
  seratoPlaylistsFieldOffered: false,
  syncEngineDj: false,
  syncSerato: false,
  betaUpdates: false,
  traktorCueOffsetMs: 0,
  filenameFormat: '',
  titleFormat: '',
  autoApplyFilename: false,
  groupingPresets: [],
  genrePresets: [],
  genreSeparator: ', ',
  groupingSeparator: ', ',
  trimWhitespace: true,
  zeroPadTrack: true,
  fullReleaseDate: false,
  asciiFileNames: false,
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
  autoCleanSpacing: false,
  autoCleanCase: false,
  continuousPlayback: false,
  keyNotation: 'camelot',
  normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
  declick: { mode: 'off', noise: 'off' },
  shortcutOverrides: {},
  editorSections: DEFAULT_EDITOR_SECTIONS,
  commandUsage: {},
  musicReviewIgnored: [],
  listReviewIgnored: [],
  hasSeenOnboarding: false,
  deezerProviderMigrated: true,
  musicbrainzProviderMigrated: true,
  backupPolicyMigrated: true,
  backupLimitsMigrated: true,
  trackImportFieldsMigrated: true,
  conversionCount: 0,
  stats: {
    imported: 0,
    listened: 0,
    analyzed: 0,
    discogsMatches: 0,
    bandcampMatches: 0,
    deezerMatches: 0,
    beatportMatches: 0,
    musicbrainzMatches: 0,
  },
  donateNudgeDismissed: false,
  donateNudgeLastShown: '',
  lastSeenChangelogVersion: '',
}

export interface ProgramReads {
  available(): Promise<boolean>
  tree(): Promise<SourceNode[]>
  recentCount(): Promise<number>
  trackCount(): Promise<number>
  playlist(id: string): Promise<SourcePlaylistEntry[]>
  membership(paths: string[]): Promise<Record<string, string[]>>
  collection(): Promise<CollectionTrack[]>
  editPlaylist(
    edit: RekordboxPlaylistEdit,
    label?: string,
    mode?: PlaylistEditMode,
  ): Promise<RekordboxEditResult>
  hasSeparator(): Promise<boolean>
  cueQueue(): Promise<RekordboxQueueState>
  applyCueQueue(): Promise<RekordboxQueueApplied | null>
  discardCueQueue(): Promise<void>
  cueQueueReady(): Promise<void>
  onCueQueueChanged(cb: (state: RekordboxQueueState) => void): () => void
  onCueQueueApplied(cb: (applied: RekordboxQueueApplied) => void): () => void
}

const EMPTY_READS: ProgramReads = {
  available: async () => false,
  tree: async () => [],
  recentCount: async () => 0,
  trackCount: async () => 0,
  playlist: async () => [],
  membership: async () => ({}),
  collection: async () => [],
  editPlaylist: async () => ({ applied: false, reason: 'unreadable' }),
  hasSeparator: async () => false,
  cueQueue: async () => ({ tracks: 0, changes: 0, items: [] }),
  applyCueQueue: async () => null,
  discardCueQueue: async () => {},
  cueQueueReady: async () => {},
  onCueQueueChanged: () => () => {},
  onCueQueueApplied: () => () => {},
}

export type DjReads = Partial<Record<DjProgram, Partial<ProgramReads>>>

const layersOf = new WeakMap<DjApi, DjReads[]>()

export function djReads(...layers: (DjReads | DjApi | undefined)[]): DjApi {
  const flat = layers.flatMap((layer) => {
    if (!layer) return []
    return layersOf.get(layer as DjApi) ?? [layer as DjReads]
  })
  const of = (p: DjProgram): ProgramReads =>
    Object.assign({}, EMPTY_READS, ...flat.map((layer) => layer[p]))
  const api: DjApi = {
    available: vi.fn((p) => of(p).available()),
    tree: vi.fn((p) => of(p).tree()),
    recentCount: vi.fn((p) => of(p).recentCount()),
    trackCount: vi.fn((p) => of(p).trackCount()),
    playlist: vi.fn((p, id) => of(p).playlist(id)),
    membership: vi.fn((p, paths) => of(p).membership(paths)),
    collection: vi.fn((p) => of(p).collection()),
    editPlaylist: vi.fn((p, ...args: Parameters<ProgramReads['editPlaylist']>) =>
      of(p).editPlaylist(...args),
    ),
    hasSeparator: vi.fn((p) => of(p).hasSeparator()),
    cueQueue: vi.fn((p) => of(p).cueQueue()),
    applyCueQueue: vi.fn((p) => of(p).applyCueQueue()),
    discardCueQueue: vi.fn((p) => of(p).discardCueQueue()),
    cueQueueReady: vi.fn((p) => of(p).cueQueueReady()),
    onCueQueueChanged: vi.fn((p, cb) => of(p).onCueQueueChanged(cb)),
    onCueQueueApplied: vi.fn((p, cb) => of(p).onCueQueueApplied(cb)),
  }
  layersOf.set(api, flat)
  return api
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
export type ApiOverrides = Omit<Partial<Api>, 'cues'> & { cues?: Partial<CuesApi> }

const NO_CUES: CuesApi = {
  trackCues: async () => null,
  waveDetail: async () => null,
  waveFine: async () => null,
  dropInput: async () => null,
  twins: async () => ({}),
  auditionLead: async () => 0,
  surcoGrid: async () => null,
  gridFit: async () => null,
  gridVerdict: async () => null,
  queued: async () => null,
  undo: async () => {},
  save: async () => {},
}

export function stubApi({ cues, ...over }: ApiOverrides = {}): Api {
  const noop = (): void => {}
  const unsubscribe = () => noop
  return {
    platform: 'darwin',
    dj: djReads(),
    cues: { ...NO_CUES, ...cues },
    storeBuild: false,
    version: '0.0.0-test',
    getPathForFile: () => '',
    expandPaths: async () => [],
    sourceChanged: async () => false,
    onFilesChanged: () => () => {},
    onExpandedBatch: unsubscribe,
    onNotAudioSkipped: unsubscribe,
    takePendingFiles: async () => [],
    onOpenFiles: unsubscribe,
    onFoldersChanged: unsubscribe,
    unwatchFolders: async () => {},
    getLastSession: async () => ({ paths: [], edits: {} }),
    saveLastSession: async () => {},
    saveLastSessionSync: () => {},
    getSettings: async () => testSettings,
    saveSettings: async () => testSettings,
    beatportConnect: async () => testSettings,
    beatportDisconnect: async () => testSettings,
    recordStat: noop,
    getConfigDir: async () => null,
    defaultConfigDir: async () => '',
    setConfigDir: async () => testSettings,
    configDirHasSettings: async () => false,
    cacheStats: async () => ({ files: 0, bytes: 0 }),
    clearCache: async () => {},
    pickConfigDir: async () => null,
    pickFiles: async () => [],
    pickOutputDir: async () => null,
    pickEngineLibraryDir: async () => null,
    pickTraktorNmlPath: async () => null,
    pickRekordboxDbPath: async () => null,
    detectTraktorNmlPath: async () => null,
    traktorCollectionInUse: async () => null,
    rekordboxCollection: async () => '',
    appleMusicEntryLocation: async () => '',
    appleMusicEntryMeta: async () => null,
    appleMusicArtwork: async () => ({}),
    search: async () => [],
    getRelease: async () => {
      throw new Error('stubApi: this test needs its own getRelease')
    },
    loadAppleMusicLibrary: async () => [],
    appleMusicFileEntries: async () => ({ consulted: false, entries: {} }),
    loadMusicReview: async () => [],
    applyMusicFixes: async () => [],
    cancelMusicFixes: async () => {},
    syncLibraryTags: async () => {
      const nothing = { outcome: 'nothing' as const }
      return { rekordbox: nothing, engine: nothing, traktor: nothing, serato: nothing }
    },
    replaceDuplicatesInLibraries: async () => [],
    libraryStatus: async () => {
      const off = { enabled: false, found: false }
      return { rekordbox: off, engine: off, traktor: off, serato: off }
    },
    libraryCopyInfo: async () => ({}),
    scanDamage: async () => ({ findings: [], unread: [] }),
    repairDamage: async () => [],
    setMusicField: async () => 'missing',
    removeMusicDuplicate: async () => ({ outcome: 'missing', playlists: 0, fileTrashed: false }),
    onMusicFixProgress: unsubscribe,
    applyListFixes: async () => [],
    cancelListFixes: async () => {},
    onListFixProgress: unsubscribe,
    removeListDuplicates: async () => [],
    onListRemovalPhase: unsubscribe,
    loadAppleMusicLibraryCached: async () => null,
    loadAppleMusicPlaylists: async () => [],
    seratoRunning: async () => false,
    djAppRunning: async () => false,
    holdsInLibrary: async () => true,
    rowWaves: async () => ({}),
    rekordboxCountCompletable: async () => 0,
    cueProfile: async () => ({
      profile: null,
      edits: { count: 0, sinceLearn: 0, corrected: 0 },
      marked: 0,
    }),
    learnCueProfile: async () => {
      throw new Error('no collection to learn from')
    },
    recordCueEdit: async () => {},
    onCueProfileChanged: () => () => {},
    traktorCanSave: async () => true,
    usbVolumes: async () => ({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: unsubscribe,
    usbPickFolder: async () => null,
    usbPlan: async () => ({ ok: false, reason: 'nothing-selected' }),
    usbExport: async () => ({ ok: false, reason: 'nothing-selected' }),
    usbCancel: async () => false,
    onUsbEvent: unsubscribe,
    loadAppleMusicPlaylistTracks: async () => ({
      paths: [],
      persistentIds: {},
      meta: {},
      missing: 0,
    }),
    loadAppleMusicLibraryPlaylistTracks: async () => null,
    loadAppleMusicPlaylistsCached: async () => null,
    loadAppleMusicPlaylistCached: async () => null,
    loadEngineLibrary: async () => [],
    addToAppleMusic: async () => undefined,
    updateAppleMusic: async () => undefined,
    revealAppleMusic: async () => {},
    deleteAppleMusic: async () => undefined,
    processTrack: async () => {
      throw new Error('stubApi: this test needs its own processTrack')
    },
    onVerifyUpdate: unsubscribe,
    retryVerification: async () => 'rechecked',
    verifyMusicAdded: async () => {},
    releasePlayingFile: async () => {},
    beginConversionBatch: noop,
    endConversionBatch: noop,
    cancelJob: noop,
    reportUnsavedCues: noop,
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
    pathAliases: async (paths) => paths,
    reveal: async () => {},
    openFile: async () => '',
    trashFile: async () => {},
    // Local by default in tests: the cautious "may be permanent" wording is the exception,
    // and a test that wants it says so.
    keepsTrash: async () => true,
    retireSuperseded: async () => 'retired',
    trashList: async () => [],
    trashRestore: async () => ({ restoredTo: '' }),
    trashRemove: async () => {},
    trashEmpty: async () => {},
    trashReveal: async () => {},
    copyText: async () => {},
    logError: noop,
    logInfo: noop,
    revealLog: async () => {},
    revealBackups: async () => '',
    copiesStatus: async () => [],
    restoreCopy: async () => ({ ok: true }),
    onCopiesChanged: () => () => {},
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
    peekAnalysis: async () => null,
    recallAutoMatches: async () => ({}),
    rememberAutoMatch: async () => null,
    loudness: async () => null,
    fingerprint: async () => null,
    comparePair: async () => null,
    limiterGlimpse: async () => null,
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
    readMetaLight: async () => ({
      tags: emptyMetadata(),
      duration: null,
      cover: null,
      foreignTags: [],
      partial: false,
    }),
    readCover: async () => null,
    readCoverFull: async () => null,
    onMenuCommand: unsubscribe,
    onProcessProgress: unsubscribe,
    onActivity: unsubscribe,
    installUpdate: async () => {},
    onUpdateDownloaded: unsubscribe,
    onUpdateError: unsubscribe,
    onRekordboxSyncIssue: unsubscribe,
    onEngineSyncIssue: unsubscribe,
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
export function installApi(over: ApiOverrides = {}): Api {
  const api = stubApi(over)
  ;(globalThis.window as unknown as { api: Api }).api = api
  return api
}
