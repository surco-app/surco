// @vitest-environment jsdom
import { BUNDLED_FLOWS } from '../../shared/cueFlows'
import { WINDOW_MIN_SIZE } from '../../shared/windowSize'
import '@testing-library/jest-dom/vitest'
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import type { Api } from '../../preload/api'
import { ALL_TRACKS_ID } from '../../shared/allTracks'
import type { DjApi } from '../../shared/djApi'
import { DEFAULT_EDITOR_SECTIONS } from '../../shared/editorSections'
import { MATCHING_ID } from '../../shared/matching'
import { emptyMetadata } from '../../shared/metadata'
import { RECENTLY_ADDED_ID } from '../../shared/recentlyAdded'
import { DEFAULT_SESSION_WIZARD } from '../../shared/sessionSettings'
import { TO_REVIEW_ID } from '../../shared/toReview'
import type {
  ActivityEvent,
  ProgramCopies,
  RekordboxEditResult,
  RekordboxQueueApplied,
  RekordboxSyncIssue,
  Release,
  RestoreResult,
  SessionEdit,
  Settings,
  SourceNode,
  UsbExportEvent,
  UsbVolume,
  UsbVolumeList,
} from '../../shared/types'
import { resetEditorSections } from './hooks/useEditorSections'
import { resetGridChecks } from './hooks/useGridChecks'
import { MAX_META_UNDO } from './hooks/useMetaUndo'
import { NEW_TRACKS_PROMPT_TIMEOUT_MS } from './hooks/useTrackLibrary'
import i18n from './i18n'
import { startDraft } from './lib/cueDraft'
import {
  autoMarkOf,
  forgetDraft,
  keepAutoMark,
  keepDraft,
  keepGridAdjust,
  resetCueSession,
} from './lib/cueSession'
import { resetEditorPlace } from './lib/editorPlace'
import { spellingGroups } from './lib/musicSpelling'
import { holdPendingEdit } from './lib/pendingEdits'
import { createQueryClient } from './lib/queryClient'
import { clearDraggedRows, draggedRows, TREE_NODE_TYPE } from './lib/reorderDrag'
import { offerShortcutUndo, takeShortcutUndo } from './lib/shortcutUndo'
import { formatCount } from './lib/stats'
import { usbExportStore } from './lib/usbExportStore'
import { type ApiOverrides, djReads, type ProgramReads, stubApi } from './test/api'
import { fakeDataTransfer, installDragEvent } from './test/drag'
import { hoverTooltip } from './test/tooltip'

// Pass-through triage that counts sort runs, so the derived-list stability test can
// assert renders without track changes skip the whole filter+sort pipeline.
const { sortRuns } = vi.hoisted(() => ({ sortRuns: { count: 0 } }))

// Pass-through Editor wrapped in its own memo, so the counter only ticks when App
// hands it a changed prop identity — the contract the editor-stability test pins.
const { editorRenders } = vi.hoisted(() => ({ editorRenders: { count: 0 } }))
vi.mock('./components/Editor', async (importOriginal) => {
  const real = await importOriginal<typeof import('./components/Editor')>()
  const { memo } = await import('react')
  const CountingEditor = memo(function CountingEditor(
    props: React.ComponentProps<typeof real.Editor>,
  ): React.JSX.Element {
    editorRenders.count++
    return <real.Editor {...props} />
  })
  return { ...real, Editor: CountingEditor }
})
const { idlePreload } = vi.hoisted(() => ({ idlePreload: { calls: 0 } }))
vi.mock('./lib/lazyChunk', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/lazyChunk')>()
  return {
    ...real,
    preloadLazyWhenIdle: () => {
      idlePreload.calls++
      real.preloadLazyWhenIdle()
    },
  }
})
// Pass-through TrackList that counts renders — TrackList is already memo'd itself
// (see TrackList.tsx), so wrapping the real (already-memoized) component in a
// second counting memo pins the contract from the outside: App must hand it
// stable props on a render that doesn't touch the visible tracks.
const { trackListRenders } = vi.hoisted(() => ({
  trackListRenders: { count: 0, shown: [] as { ids: string[]; selectedId: string | null }[] },
}))
vi.mock('./components/TrackList', async (importOriginal) => {
  const real = await importOriginal<typeof import('./components/TrackList')>()
  const { memo } = await import('react')
  const CountingTrackList = memo(function CountingTrackList(
    props: React.ComponentProps<typeof real.TrackList>,
  ): React.JSX.Element {
    trackListRenders.count++
    trackListRenders.shown.push({
      ids: props.tracks.map((t) => t.id),
      selectedId: props.selectedId,
    })
    return <real.TrackList {...props} />
  })
  return { ...real, TrackList: CountingTrackList }
})
// Pass-through Toolbar that keeps the props of its last render, so a test can check that
// App hands it the same identity for a prop across App renders.
const { toolbarProps } = vi.hoisted(() => ({
  toolbarProps: { last: null as { usbPill?: unknown } | null },
}))
vi.mock('./components/Toolbar', async (importOriginal) => {
  const real = await importOriginal<typeof import('./components/Toolbar')>()
  const { memo } = await import('react')
  const CountingToolbar = memo(function CountingToolbar(
    props: React.ComponentProps<typeof real.Toolbar>,
  ): React.JSX.Element {
    toolbarProps.last = props
    return <real.Toolbar {...props} />
  })
  return { ...real, Toolbar: CountingToolbar }
})
vi.mock('./lib/triage', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/triage')>()
  const sortTracks: typeof real.sortTracks = (tracks, sortBy, dir) => {
    sortRuns.count++
    return real.sortTracks(tracks, sortBy, dir)
  }
  return { ...real, sortTracks }
})
// The real changelog data grows with every release; pinning it keeps the what's-new
// tests about the launch gating, not about whatever shipped last.
const { changelogLoads } = vi.hoisted(() => ({ changelogLoads: { count: 0 } }))
vi.mock('./lib/changelog', () => ({
  changelogReleases: async () => {
    changelogLoads.count++
    return [
      {
        version: '0.33',
        date: '10 de julio de 2026',
        title: 'Novedades y avisos',
        items: [
          { text: 'Popup de novedades tras actualizar.', in: '0.33.0' },
          { text: 'Arreglo del análisis a 48 kHz.', in: '0.33.1' },
        ],
      },
    ]
  },
}))

afterEach(cleanup)

function settings(over: Partial<Settings> = {}): Settings {
  return {
    editorSections: DEFAULT_EDITOR_SECTIONS,
    resultsWidth: null,
    theme: 'system',
    density: 'normal',
    showListWaves: true,
    showListPositions: true,
    matchingSuggestionsOpen: true,
    showRailNames: true,
    showSidebar: true,
    cueFlows: BUNDLED_FLOWS,
    activeCueFlow: 'mine',
    cueJumpBars: 16,
    cueQuantize: 'bar',
    cueGridTolerance: 10,
    cueLettersByTime: true,
    cueFlowToRekordbox: true,
    cueFlowToTraktor: true,
    cueFlowToEngine: true,
    cueFlowToSerato: true,
    cueFlowToVirtualdj: true,
    cueLearnFromEdits: true,
    hiddenSources: [],
    sessionWizard: { ...DEFAULT_SESSION_WIZARD },
    sessionsMade: [],
    matchingDismissed: [],
    commentsToFile: true,
    commentsReplace: false,
    language: 'system',
    discogsToken: '',
    beatportUsername: '',
    beatportPassword: '',
    discogsFormats: [],
    discogsMaxResults: 10,
    searchProviders: ['discogs'],
    searchIgnoreWords: [],
    searchByAlbumFirst: false,
    autoCleanSpacing: false,
    autoCleanCase: false,
    outputDir: '',
    outputFormat: 'aiff',
    keepMp3Sources: false,
    clearListAfterConvert: false,
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
    engineLibraryDir: '/music/Engine Library',
    traktorNmlPath: '',
    rekordboxDbPath: '',
    syncTraktor: false,
    syncRekordbox: false,
    completeCuesOnClose: false,
    rekordboxPlaylistsFieldOffered: true,
    traktorPlaylistsFieldOffered: true,
    enginePlaylistsFieldOffered: true,
    seratoPlaylistsFieldOffered: false,
    virtualdjPlaylistsFieldOffered: false,
    syncEngineDj: false,
    addToSerato: false,
    syncSerato: false,
    addToVirtualdj: false,
    syncVirtualdj: false,
    virtualdjLibraryDir: '',
    betaUpdates: false,
    autoUpdates: true,
    traktorCueOffsetMs: 0,
    filenameFormat: '{artist} - {title}',
    titleFormat: '',
    autoApplyFilename: false,
    groupingPresets: [],
    genrePresets: [],
    genreSeparator: ', ',
    groupingSeparator: ', ',
    trimWhitespace: true,
    zeroPadTrack: true,
    asciiFileNames: false,
    fullReleaseDate: false,
    visibleFields: ['title', 'artist'],
    requiredFields: ['title', 'artist'],
    coverMaxSize: 1000,
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
    autoAnalyze: false,
    showWaveform: true,
    showLoudness: false,
    showEditorHints: true,
    autoMatch: false,
    continuousPlayback: false,
    keyNotation: 'camelot',
    normalize: { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 },
    declick: { mode: 'off', noise: 'off' },
    shortcutOverrides: {},
    commandUsage: {},
    musicReviewIgnored: [],
    listReviewIgnored: [],
    hasSeenOnboarding: true,
    deezerProviderMigrated: true,
    musicbrainzProviderMigrated: true,
    itunesProviderMigrated: true,
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
      itunesMatches: 0,
    },
    donateNudgeDismissed: false,
    donateNudgeLastShown: '',
    silenceInPlaceWarning: false,
    silenceLossyWarning: false,
    // Matches setApi's version so unrelated tests never trigger the launch stamp.
    lastSeenChangelogVersion: '0.0.0-test',
    ...over,
  }
}

// A clear cutoff well below Nyquist so the verdict is a real value (not 'unanalyzed'),
// which is what makes a quality dot appear on the row.
const spectrum = { image: 'data:image/png;base64,', cutoffHz: 16000, sampleRateHz: 44100 }
const wave = { peaks: [0.2, 0.8, 0.5, 1], durationSec: 180 }

// jsdom ships no IntersectionObserver. This stub records what each row observes and reports
// nothing visible by default, so a test can scroll a specific row into view on demand and
// assert the visible-gated auto-match only fires for what's on screen.
const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = []
class MockIntersectionObserver {
  cb: IntersectionObserverCallback
  els = new Set<Element>()
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb
    observers.push({ cb, els: this.els })
  }
  observe(el: Element): void {
    this.els.add(el)
  }
  unobserve(el: Element): void {
    this.els.delete(el)
  }
  disconnect(): void {
    this.els.clear()
  }
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

let menuListener: ((id: string) => void) | undefined

function runMenu(id: string): void {
  act(() => menuListener?.(id))
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    version: '0.0.0-test',
    releasePlayingFile: vi.fn<Api['releasePlayingFile']>().mockResolvedValue(undefined),
    prewarmPlayback: vi.fn<Api['prewarmPlayback']>(),
    checkZoom: vi.fn<Api['checkZoom']>(),
    matchingPairs: vi.fn<Api['matchingPairs']>().mockResolvedValue([]),
    addMatchingPair: vi.fn<Api['addMatchingPair']>().mockResolvedValue(undefined),
    removeMatchingPair: vi.fn<Api['removeMatchingPair']>().mockResolvedValue(undefined),
    removeMatchingPairs: vi.fn<Api['removeMatchingPairs']>().mockResolvedValue(undefined),
    getSettings: vi.fn().mockResolvedValue(settings()),
    loadAppleMusicLibraryPlaylistTracks: vi.fn().mockResolvedValue(null),
    loadAppleMusicPlaylistsCached: vi.fn().mockResolvedValue(null),
    loadAppleMusicPlaylistCached: vi.fn().mockResolvedValue(null),
    keepsTrash: vi.fn().mockResolvedValue(true),
    saveSettings: vi.fn<Api['saveSettings']>().mockResolvedValue(settings()),
    recordStat: vi.fn(),
    rekordboxCollection: vi.fn<Api['rekordboxCollection']>().mockResolvedValue(''),
    logError: vi.fn(),
    reportSnapshot: vi.fn<Api['reportSnapshot']>(),
    getConfigDir: vi.fn().mockResolvedValue(null),
    defaultConfigDir: vi.fn().mockResolvedValue('/Users/test/Library/Application Support/Surco'),
    cacheStats: vi.fn().mockResolvedValue({ files: 0, bytes: 0 }),
    clearCache: vi.fn().mockResolvedValue(undefined),
    detectTraktorNmlPath: vi.fn().mockResolvedValue(null),
    appleMusicArtwork: vi.fn<Api['appleMusicArtwork']>().mockResolvedValue({}),
    recallAutoMatches: vi.fn<Api['recallAutoMatches']>().mockResolvedValue({}),
    rememberAutoMatch: vi.fn<Api['rememberAutoMatch']>().mockResolvedValue(null),
    onMenuCommand: (cb: (id: string) => void) => {
      menuListener = cb
      return () => {}
    },
    onProcessProgress: () => () => {},
    onActivity: () => () => {},
    onUpdateDownloaded: () => () => {},
    onUpdateError: () => () => {},
    onUpdateCheckFailed: () => () => {},
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    onOpenFiles: () => () => {},
    onExpandedBatch: () => () => {},
    onNotAudioSkipped: () => () => {},
    onFoldersChanged: () => () => {},
    onFilesChanged: () => () => {},
    sourceChanged: vi.fn<Api['sourceChanged']>().mockResolvedValue(false),
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    takePendingFiles: vi.fn().mockResolvedValue([]),
    getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
    saveLastSession: vi.fn().mockResolvedValue(undefined),
    loadPreviousSession: vi.fn<Api['loadPreviousSession']>().mockResolvedValue(null),
    clearPreviousSession: vi.fn<Api['clearPreviousSession']>().mockResolvedValue(undefined),
    expandPaths: vi.fn((paths: string[]) => Promise.resolve(paths)),
    pathAliases: vi.fn((paths: string[]) => Promise.resolve(paths)),
    onVerifyUpdate: vi.fn<Api['onVerifyUpdate']>(() => () => {}),
    retryVerification: vi.fn<Api['retryVerification']>().mockResolvedValue('rechecked'),
    copiesStatus: vi.fn<Api['copiesStatus']>().mockResolvedValue([]),
    onCopiesChanged: vi.fn<Api['onCopiesChanged']>(() => () => {}),
    traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(true),
    onWindowFocus: () => () => {},
    usbVolumes: vi.fn<Api['usbVolumes']>().mockResolvedValue({ volumes: [], lastKey: null }),
    onUsbVolumesChanged: () => () => {},
    onUsbEvent: () => () => {},
    hasClipboardImage: vi.fn().mockResolvedValue(false),
    pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
    readTags: vi.fn().mockResolvedValue({}),
    readDuration: vi.fn().mockResolvedValue(180),
    readCover: vi.fn().mockResolvedValue(null),
    readMetaCached: vi.fn<Api['readMetaCached']>().mockResolvedValue({}),
    // Mirrors the real readMeta (one round-trip for all three) by delegating to the
    // individual mocks at call time, so a test overriding readTags/readDuration/readCover
    // still drives the import without having to know they were collapsed into one call.
    readMeta: vi.fn(async (path: string) => {
      const api = (window as unknown as { api: Record<string, (p: string) => unknown> }).api
      const [tags, duration, cover] = await Promise.all([
        api.readTags(path),
        api.readDuration(path),
        api.readCover(path),
      ])
      return { tags, duration, cover }
    }),
    // The light read as the real one: the full read without the cover and the foreign tags,
    // delegated at call time so a test that drives readMeta drives a library row's read too.
    readMetaLight: vi.fn(async (path: string) => {
      const api = (window as unknown as { api: { readMeta: (p: string) => Promise<object> } }).api
      return { ...(await api.readMeta(path)), cover: null, foreignTags: [], partial: true }
    }),
    properties: vi.fn().mockResolvedValue(null),
    loudness: vi.fn().mockResolvedValue(null),
    bpm: vi.fn().mockResolvedValue(null),
    key: vi.fn().mockResolvedValue(null),
    waveformScan: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue([]),
    // Rejects rather than resolving null: the handler either returns a Release or
    // throws (search:release calls straight into the provider), so a null here was a
    // shape the app can never receive. Tests that need a release override this.
    getRelease: vi.fn<Api['getRelease']>().mockRejectedValue(new Error('no release in this test')),
    spectrogram: vi.fn().mockResolvedValue(spectrum),
    loadCachedAnalyses: vi.fn<Api['loadCachedAnalyses']>().mockResolvedValue({}),
    peekAnalysis: vi.fn<Api['peekAnalysis']>().mockResolvedValue(null),
    waveform: vi.fn().mockResolvedValue(wave),
    cancelAnalysis: vi.fn().mockResolvedValue(undefined),
    clicks: vi.fn().mockResolvedValue(null),
    // The repair section subscribes to render progress on mount, so the bridge must
    // hand back an unsubscribe even in tests that never open it.
    onDeclickPreviewProgress: vi.fn().mockReturnValue(() => {}),
    cancelDeclickPreview: vi.fn().mockResolvedValue(undefined),
    // Fired at the top of every convert-all run (it resets main's conflict-decision
    // memory), at the end of every run (it flushes main's recorded Traktor patches), and
    // to cancel a single convert; stub all so processAll doesn't throw.
    conversionPrograms: vi.fn<Api['conversionPrograms']>().mockResolvedValue([]),
    beginConversionBatch: vi.fn(),
    endConversionBatch: vi.fn(),
    cancelJob: vi.fn(),
    reportUnsavedCues: vi.fn<Api['reportUnsavedCues']>(),
    ...over,
    cues: { ...stubApi().cues, ...(over.cues as object | undefined) },
    dj: djReads(
      {
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(false),
          membership: vi.fn<ProgramReads['membership']>().mockResolvedValue({}),
          hasSeparator: vi.fn<ProgramReads['hasSeparator']>().mockResolvedValue(true),
          editPlaylist: vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true }),
        },
        engine: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(false) },
        traktor: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(false) },
        serato: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(false) },
      },
      over.dj as DjApi | undefined,
    ),
  }
}

beforeEach(() => {
  setApi()
  trackListRenders.shown = []
  // The editor section store is module-level and survives across tests; reset it so a
  // test that folds a section away doesn't leak that state into the next.
  resetEditorSections()
  resetEditorPlace()
  resetCueSession()
  observers.length = 0
  globalThis.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver
  // jsdom ships neither, and App's theme effect reads matchMedia on mount while
  // newTrack mints ids with crypto.randomUUID.
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia
  // jsdom implements none of HTMLMediaElement.play/pause/load; the floating player calls
  // play (and .catch on its returned promise) the instant it opens, pause on close or when
  // continuous playback advances, and load when its source changes.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLMediaElement.prototype.pause = vi.fn()
  HTMLMediaElement.prototype.load = vi.fn()
  // jsdom has no 2D canvas context (it logs a not-implemented error and returns null);
  // the player's Waveform draws to one the moment playback opens. Stub it to null like
  // the Player/Waveform tests do, so the playback tests don't spew that error.
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null)
})

// App and parts of its tree read window.api.platform at module scope, so it must be
// imported only after the bridge mock is in place — a dynamic import after beforeEach.
async function renderApp(): Promise<QueryClient> {
  const { default: App } = await import('./App')
  await (await import('./lib/lazyChunk')).preloadLazy()
  const client = createQueryClient()
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return client
}

// Adding files selects them all; these tests are about one open track, so the first row is
// opened the way a user would after the drop.
async function addTwoTracks(): Promise<HTMLElement[]> {
  fireEvent.click(await screen.findByTestId('add-files'))
  await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  fireEvent.click(screen.getAllByTestId('track-row')[0])
  return screen.getAllByTestId('track-row')
}

async function addOneTrack(): Promise<HTMLElement[]> {
  fireEvent.click(await screen.findByTestId('add-files'))
  await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  return screen.getAllByTestId('track-row')
}

// The player slides in with translateY(100%), so for 0.26s it is drawn a card's height
// BELOW the sidebar. With nothing clipping it that overhang counts as scrollable page,
// and a vertical scrollbar flashes down the right edge of the window and vanishes. The
// column has to clip its own children; the animation is fine as it is.
// Joined settings tabs sit behind their sidebar row: open the row, then pick the tab.
const openTab = (row: string, tab: string): void => {
  fireEvent.click(screen.getByTestId(`settings-tab-${row}`))
  fireEvent.click(screen.getByTestId(`settings-subtab-${tab}`))
}

describe('App unsaved cues', () => {
  afterEach(resetCueSession)

  it('tells main which tracks hold unsaved cues, so quitting asks before losing them and closing rekordbox writes nothing under them', async () => {
    await renderApp()
    act(() =>
      keepDraft('103', '103|f0|null', startDraft([], 'mine'), {
        path: '/m/a.wav',
        label: 'a',
        fingerprint: 'f0',
      }),
    )
    await waitFor(() => expect(window.api.reportUnsavedCues).toHaveBeenLastCalledWith(['103']))
    act(() => forgetDraft('103'))
    await waitFor(() => expect(window.api.reportUnsavedCues).toHaveBeenLastCalledWith([]))
  })

  it('forgets a draft built on a queued save once the queue changes under it, so quitting no longer asks for it', async () => {
    let pushQueue: Parameters<ProgramReads['onCueQueueChanged']>[0] = () => {}
    setApi({
      dj: djReads({
        rekordbox: {
          onCueQueueChanged: vi.fn<ProgramReads['onCueQueueChanged']>((cb) => {
            pushQueue = cb
            return () => {}
          }),
        },
      }),
      cues: {
        trackCues: vi.fn<Api['cues']['trackCues']>(async () => ({
          contentId: '103',
          analysed: true,
          grid: [],
          strong: [],
          phrases: [],
          cues: [],
          wave: null,
          durationMs: 1000,
          fingerprint: 'f0',
          gridFingerprint: '',
        })),
        liveCues: vi.fn<Api['cues']['liveCues']>(async () => ({
          '103': { cues: [], fingerprint: 'f0' },
        })),
        queued: vi.fn<Api['cues']['queued']>(async () => null),
      },
    })
    await renderApp()
    const queued = { wanted: [], fingerprint: 'f0' }
    act(() =>
      keepDraft('103', `103|f0|${JSON.stringify(queued)}`, startDraft([], 'mine'), {
        path: '/m/a.wav',
        label: 'a',
        fingerprint: 'f0',
      }),
    )
    await waitFor(() => expect(window.api.reportUnsavedCues).toHaveBeenLastCalledWith(['103']))
    act(() => pushQueue({ tracks: 0, changes: 0, items: [] }))
    await waitFor(() => expect(window.api.reportUnsavedCues).toHaveBeenLastCalledWith([]))
  })
})

describe('App Engine DJ cues', () => {
  afterEach(() => {
    resetCueSession()
    resetGridChecks()
  })

  function openEngine(over: ApiOverrides = {}) {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav']),
      ...over,
      dj: djReads(
        {
          engine: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 2 }]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
              { path: '/m/a.wav', separator: false, meta: {}, contentId: 'engine:11' },
              { path: '/m/b.wav', separator: false, meta: {}, contentId: 'engine:12' },
            ]),
          },
        },
        over.dj,
      ),
    })
  }

  it('opens the cue editor on a row of an Engine DJ playlist, reading the cues of its Engine track', async () => {
    const read = vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null)
    openEngine({ cues: { trackCues: read } })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(read).toHaveBeenCalledWith('engine:12'))
    expect(await screen.findByTestId('cues-section')).toBeInTheDocument()
  })

  async function openFriday() {
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  // Tracks takes the same numbers as a playlist, in the order the files came in, so the
  // one View switch reads the same on every tab.
  it('numbers the rows of Tracks in their import order and a playlist in its own', async () => {
    openEngine()
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-number').map((n) => n.textContent)).toEqual(['1', '2']),
    )
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-number').map((n) => n.textContent)).toEqual(['1', '2']),
    )
  })

  // Sorted by artist the rows no longer sit in the playlist's order, and its numbers
  // down the side would read as a ranking of that sort.
  it('drops the numbers while the playlist is sorted another way', async () => {
    openEngine()
    await openFriday()
    await waitFor(() => expect(screen.getAllByTestId('track-number')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    await waitFor(() => expect(screen.queryByTestId('track-number')).not.toBeInTheDocument())
  })

  // Date added sorts nothing on a playlist that has no dates, so there it reads as the
  // playlist's own order: its label, and the numbers down the side, come back with it.
  it('reads a playlist without dates in its own order while date added is the sort', async () => {
    openEngine({
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: '7', name: 'Friday', kind: 'playlist', count: 2 },
            { id: '8', name: 'Saturday', kind: 'playlist', count: 2 },
          ]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: vi.fn<ProgramReads['playlist']>().mockImplementation(async (id) => [
            {
              path: '/m/a.wav',
              separator: false,
              meta: id === '7' ? { addedAt: 2 } : {},
              contentId: 'engine:11',
            },
            {
              path: '/m/b.wav',
              separator: false,
              meta: id === '7' ? { addedAt: 1 } : {},
              contentId: 'engine:12',
            },
          ]),
        },
      }),
    })
    await openFriday()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-dateAdded'))
    await waitFor(() => expect(screen.queryByTestId('track-number')).not.toBeInTheDocument())

    fireEvent.click(screen.getByTestId('source-node-8'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-number').map((n) => n.textContent)).toEqual(['1', '2']),
    )
    expect(screen.getByTestId('track-sort')).toHaveTextContent(i18n.t('sidebar.sort.import'))
  })

  it('leaves the playlist rows bare once the numbers are turned off', async () => {
    openEngine({ getSettings: vi.fn().mockResolvedValue(settings({ showListPositions: false })) })
    await openFriday()
    expect(screen.queryByTestId('track-number')).not.toBeInTheDocument()
  })

  it('leaves the Tracks rows bare once the numbers are turned off', async () => {
    openEngine({ getSettings: vi.fn().mockResolvedValue(settings({ showListPositions: false })) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.queryByTestId('track-number')).not.toBeInTheDocument()
  })

  // A library is the DJ's collection, not a list dropped to be converted: over a playlist
  // with nothing picked the header's Convert has nothing to do, and the count follows the
  // picked rows only, so "13 of 62" can't read as the playlist missing something (06/11).
  it('converts only the picked rows of a library playlist, and nothing when none is picked', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/m/a.aiff', inPlace: false })
    openEngine({
      cues: {
        trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null),
      },
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await openFriday()
    runMenu('process-all')
    await act(async () => {})
    expect(processTrack).not.toHaveBeenCalled()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    const convert = await screen.findByTestId('process-btn')
    expect(convert).toHaveTextContent('Convert 2 selected')
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
  })

  it('runs Auto marcar over the selected rows of an Engine DJ playlist by their Engine track', async () => {
    const dropInput = vi.fn<Api['cues']['dropInput']>().mockResolvedValue(null)
    openEngine({
      cues: {
        trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null),
        dropInput: dropInput,
      },
    })
    await openFriday()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('cues-auto-mark-all'))
    await waitFor(() => expect(autoMarkOf('engine:12')).toEqual({ kind: 'unanalysed' }))
    expect(autoMarkOf('engine:11')).toEqual({ kind: 'unanalysed' })
  })

  it('turns on the bad grid filter from the grid block of the selection', async () => {
    openEngine({ cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) } })
    await openFriday()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('grid-batch-show'))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
    await waitFor(() =>
      expect(screen.getByTestId('quality-filter-badGrid')).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('does not keep the grid block measuring tracks whose grid Surco never measures', async () => {
    openEngine({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.mp3', '/m/b.mp3']),
      cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) },
      dj: djReads({
        engine: {
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
            { path: '/m/a.mp3', separator: false, meta: {}, contentId: 'engine:11' },
            { path: '/m/b.mp3', separator: false, meta: {}, contentId: 'engine:12' },
          ]),
        },
      }),
    })
    await openFriday()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    expect(await screen.findByTestId('grid-batch-unmeasurable')).toHaveTextContent(
      i18n.t('editor.cues.gridBatch.unmeasurable', { count: 2 }),
    )
    expect(screen.queryByTestId('grid-batch-summary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('grid-batch-measuring')).not.toBeInTheDocument()
  })

  it('opens a track the grid block set aside on its own, as clicking its row does', async () => {
    openEngine({ cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) } })
    await openFriday()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    act(() =>
      keepGridAdjust('engine:12', {
        kind: 'review',
        reason: { kind: 'noBetter', beforeMs: 40, afterMs: 45 },
      }),
    )
    fireEvent.click(await screen.findByTestId('grid-batch-open-engine:12'))
    expect(await screen.findByTestId('cues-section')).toBeInTheDocument()
    expect(screen.queryByTestId('cues-multi')).not.toBeInTheDocument()
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('shows on each row of an Engine DJ playlist what Auto marcar left for its Engine track', async () => {
    openEngine()
    await openFriday()
    act(() =>
      keepAutoMark('engine:12', {
        kind: 'proposed',
        proposals: [1000, 2000].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    const chips = () =>
      screen
        .getAllByTestId('track-wave-line')
        .map((row) => within(row).queryByTestId('track-auto-mark')?.textContent ?? null)
    await waitFor(() => expect(chips()).toEqual([null, '2 proposals']))
  })

  it('offers in Engine DJ only what Surco can write there: new playlists and delete, no folders or rename', async () => {
    openEngine()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    await screen.findByTestId('source-node-7')
    expect(screen.getByTestId('source-tree-new-playlist')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-new-folder')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('source-node-7'))
    expect(screen.getByTestId('source-tree-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-rename')).not.toBeInTheDocument()
  })

  it('offers pasting a tracklist into Engine DJ, since Surco reads its collection to find the tracks', async () => {
    openEngine()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-7'))
    expect(screen.getByTestId('source-tree-delete')).toBeInTheDocument()
    expect(screen.getByTestId('source-tree-paste-tracklist')).toBeInTheDocument()
  })

  it('lets an Engine DJ row go to another playlist but never offers removing it from the open one', async () => {
    openEngine({
      dj: djReads({
        engine: {
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: '7', name: 'Friday', kind: 'playlist', count: 2 },
            { id: '8', name: 'Saturday', kind: 'playlist', count: 0 },
          ]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    const rows = await screen.findAllByTestId('track-row')
    fireEvent.contextMenu(rows[0])
    expect(await screen.findByTestId('track-menu-add-to')).toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
  })

  it('turns the open Engine DJ tab into the missing-library notice when its database goes, with no USB export from it', async () => {
    const focusListeners: ((focused: boolean) => void)[] = []
    openEngine({
      onWindowFocus: (cb: (focused: boolean) => void) => {
        focusListeners.push(cb)
        return () => {}
      },
      dj: djReads({
        engine: {
          available: vi
            .fn<ProgramReads['available']>()
            .mockResolvedValueOnce(true)
            .mockResolvedValue(false),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    await screen.findByTestId('source-node-7')
    expect(screen.queryByTestId('source-tree-missing')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-tree-export-usb')).toBeInTheDocument()
    act(() => {
      for (const cb of focusListeners) cb(true)
    })
    expect(await screen.findByTestId('source-tree-missing')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-export-usb')).not.toBeInTheDocument()
  })

  it('shows what waits for Engine DJ to close beside rekordbox’s queue', async () => {
    openEngine({
      dj: djReads({
        engine: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue({
            tracks: 1,
            changes: 0,
            items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'cues' }] }],
          }),
        },
      }),
    })
    await renderApp()
    expect(await screen.findByTestId('engine-queue-pill')).toHaveTextContent(
      '1 track waits for you to close Engine DJ',
    )
  })

  it('lines the waiting queues up as rekordbox, Engine DJ, Traktor and Serato, the order of the source rail', async () => {
    const waiting = { tracks: 1, changes: 0, items: [] }
    openEngine({
      dj: djReads({
        rekordbox: { cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting) },
        engine: { cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting) },
        traktor: { cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting) },
        serato: { cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting) },
      }),
    })
    await renderApp()
    await screen.findByTestId('serato-queue-pill')
    await screen.findByTestId('traktor-queue-pill')
    await screen.findByTestId('engine-queue-pill')
    await screen.findByTestId('rekordbox-queue-pill')
    expect(
      screen
        .getAllByTestId(/^(rekordbox|engine|traktor|serato)-queue-pill$/)
        .map((pill) => pill.dataset.testid),
    ).toEqual([
      'rekordbox-queue-pill',
      'engine-queue-pill',
      'traktor-queue-pill',
      'serato-queue-pill',
    ])
  })

  it('shows what waits for VirtualDJ to close after the Serato queue, the last program of the rail', async () => {
    const waiting = { tracks: 1, changes: 0, items: [] }
    const virtualdjCueQueueReady = vi
      .fn<ProgramReads['cueQueueReady']>()
      .mockResolvedValue(undefined)
    openEngine({
      dj: djReads({
        serato: { cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting) },
        virtualdj: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue(waiting),
          cueQueueReady: virtualdjCueQueueReady,
        },
      }),
    })
    await renderApp()
    expect(await screen.findByTestId('virtualdj-queue-pill')).toHaveTextContent(
      '1 track waits for you to close VirtualDJ',
    )
    await screen.findByTestId('serato-queue-pill')
    expect(
      screen.getAllByTestId(/^(serato|virtualdj)-queue-pill$/).map((pill) => pill.dataset.testid),
    ).toEqual(['serato-queue-pill', 'virtualdj-queue-pill'])
    expect(virtualdjCueQueueReady).toHaveBeenCalled()
  })
})

const stick = (uuid: string, by: UsbVolume['holder']['by']): UsbVolume => ({
  uuid,
  name: `Stick ${uuid}`,
  mountPoint: `E:\\`,
  filesystem: 'fat32',
  partitionScheme: 'mbr',
  totalBytes: 32e9,
  freeBytes: 20e9,
  holder: { by, at: by === 'empty' ? null : 1 },
  remembered: null,
  stickPlaylists: null,
})

describe('App Traktor cues', () => {
  afterEach(resetCueSession)

  function openTraktor(over: ApiOverrides = {}) {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav']),
      ...over,
      dj: djReads(
        {
          traktor: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: 'u1', name: 'Saturday', kind: 'playlist', count: 2 }]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
              { path: '/m/a.wav', separator: false, meta: {}, contentId: 'traktor:HD/:m/:a.wav' },
              { path: '/m/b.wav', separator: false, meta: {}, contentId: 'traktor:HD/:m/:b.wav' },
            ]),
          },
        },
        over.dj,
      ),
    })
  }

  it('opens the cue editor on a row of a Traktor playlist, reading the cues of its collection entry', async () => {
    const read = vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null)
    openTraktor({ cues: { trackCues: read } })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    fireEvent.click(await screen.findByTestId('source-node-u1'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(read).toHaveBeenCalledWith('traktor:HD/:m/:b.wav'))
    expect(await screen.findByTestId('cues-section')).toBeInTheDocument()
  })

  describe('Matching in Traktor', () => {
    const openPlaylist = async () => {
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(await screen.findByTestId('source-rail-traktor'))
      fireEvent.click(await screen.findByTestId('source-node-u1'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    }
    const paired = () => vi.fn<Api['matchingPairs']>().mockResolvedValue([['/m/a.wav', '/m/b.wav']])

    it('shows the partners Surco keeps for the chosen track and marks them in the list', async () => {
      openTraktor({ matchingPairs: paired() })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(await screen.findByTestId('matching-partner')).toHaveTextContent('b.wav')
      expect(
        within(screen.getAllByTestId('track-row')[1]).getByTestId('track-matching'),
      ).toBeInTheDocument()
    })

    it('pairs two tracks from the row menu in Surco alone when rekordbox does not hold them', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      openTraktor({ dj: djReads({ rekordbox: { match } }) })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.click(screen.getAllByTestId('track-row')[1], { metaKey: true })
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
      fireEvent.click(await screen.findByTestId('track-menu-matching'))
      await waitFor(() =>
        expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
      expect(match).not.toHaveBeenCalled()
    })

    it('writes the pair to rekordbox too when both files are in its collection', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      const collection = vi.fn<ProgramReads['collection']>().mockResolvedValue([
        { contentId: 'r1', path: '/m/a.wav', title: 'A', artist: '' },
        { contentId: 'r2', path: '/m/b.wav', title: 'B', artist: '' },
      ])
      openTraktor({ dj: djReads({ rekordbox: { match, collection } }) })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.click(screen.getAllByTestId('track-row')[1], { metaKey: true })
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
      fireEvent.click(await screen.findByTestId('track-menu-matching'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('add', ['r1', 'r2'], expect.any(String)),
      )
    })

    it('opens the Matching entry of Traktor with its pairs and a playlist to make from them', async () => {
      openTraktor({ matchingPairs: paired() })
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(await screen.findByTestId('source-rail-traktor'))
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      expect(screen.getByTestId('matching-create-playlist')).toBeEnabled()
    })

    it('pairs the chosen track with one found among the Traktor tracks', async () => {
      openTraktor()
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.change(await screen.findByTestId('matching-search'), { target: { value: 'b.wav' } })
      fireEvent.click(await screen.findByTestId('matching-result'))
      await waitFor(() =>
        expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })

    it('suggests a pair the Traktor mixed playlists hold back to back three times', async () => {
      openTraktor({
        dj: djReads({
          traktor: {
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
              { id: 'u1', name: 'Saturday', kind: 'playlist', count: 2 },
              {
                id: 'f1',
                name: 'COMBOS',
                kind: 'folder',
                count: 0,
                children: ['s1', 's2', 's3'].map((id) => ({
                  id,
                  name: id,
                  kind: 'playlist' as const,
                  count: 2,
                })),
              },
            ]),
            playedTogether: vi.fn<ProgramReads['playedTogether']>().mockResolvedValue([
              ['/m/a.wav', '/m/b.wav'],
              ['/m/a.wav', '/m/b.wav'],
              ['/m/a.wav', '/m/b.wav'],
            ]),
          },
        }),
      })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(await screen.findByTestId('matching-suggested')).toHaveTextContent('b.wav')
      fireEvent.click(screen.getByTestId('matching-suggested-match'))
      await waitFor(() =>
        expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })

    it('unpairs two selected tracks from the row menu, the same gesture that paired them', async () => {
      openTraktor({ matchingPairs: paired() })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await within(screen.getAllByTestId('track-row')[1]).findByTestId('track-matching')
      fireEvent.click(screen.getAllByTestId('track-row')[1], { metaKey: true })
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
      fireEvent.click(await screen.findByTestId('track-menu-unmatch'))
      await waitFor(() =>
        expect(window.api.removeMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })

    it('unpairs from the menu of the one row marked with the rings, the pair the DJ sees', async () => {
      openTraktor({ matchingPairs: paired() })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await within(screen.getAllByTestId('track-row')[1]).findByTestId('track-matching')
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
      fireEvent.click(await screen.findByTestId('track-menu-unmatch'))
      await waitFor(() =>
        expect(window.api.removeMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })

    it('empties the block of the right-clicked row from the Matching entry of Traktor', async () => {
      openTraktor({ matchingPairs: paired() })
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(await screen.findByTestId('source-rail-traktor'))
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-remove'))
      fireEvent.click(await screen.findByTestId('confirm-ok'))
      await waitFor(() =>
        expect(window.api.removeMatchingPairs).toHaveBeenCalledWith([['/m/a.wav', '/m/b.wav']]),
      )
      expect(screen.getAllByTestId('track-row')).toHaveLength(2)
    })

    it('asks before emptying a block from Matching even for one track, and keeps it on cancel', async () => {
      openTraktor({ matchingPairs: paired() })
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(await screen.findByTestId('source-rail-traktor'))
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-remove'))
      fireEvent.click(await screen.findByTestId('confirm-cancel'))
      expect(window.api.removeMatchingPairs).not.toHaveBeenCalled()
    })

    it('unpairs a partner from the editor', async () => {
      openTraktor({ matchingPairs: paired() })
      await openPlaylist()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('matching-partner-remove'))
      await waitFor(() =>
        expect(window.api.removeMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })
  })

  it('lets the DJ organise Traktor playlists once the collection is confirmed, and not before', async () => {
    openTraktor({ traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(true) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    expect(await screen.findByTestId('source-tree-new-playlist')).toBeInTheDocument()
  })

  it('keeps Traktor’s HISTORY closed to tracks and its built-in lists to tracks only, so Surco never breaks what Traktor manages', async () => {
    openTraktor({
      traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(true),
      dj: djReads({
        traktor: {
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: 'prep', name: 'Preparation', kind: 'playlist', count: 0 },
            { id: 'hist', name: 'HISTORY', kind: 'playlist', count: 0 },
            { id: 'u2', name: 'Sunday', kind: 'playlist', count: 0 },
            { id: 'u1', name: 'Saturday', kind: 'playlist', count: 2 },
          ]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-prep'))
    expect(screen.getByTestId('source-tree-paste-tracklist')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-rename')).not.toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-delete')).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('source-tree-menu'), { key: 'Escape' })
    fireEvent.contextMenu(screen.getByTestId('source-node-hist'))
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('source-node-u2'))
    expect(screen.getByTestId('source-tree-menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByTestId('source-node-u1'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('track-menu-add-to'))
    expect(screen.getByTestId('track-menu-playlist-prep')).toBeInTheDocument()
    expect(screen.getByTestId('track-menu-playlist-u2')).toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-playlist-hist')).not.toBeInTheDocument()
  })

  it('opens the USB export from the Traktor tree on its playlists and asks for a Traktor export', async () => {
    const usbPlan = vi
      .fn<Api['usbPlan']>()
      .mockResolvedValue({ ok: false, reason: 'nothing-selected' })
    openTraktor({
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }),
      usbPlan,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    fireEvent.click(await screen.findByTestId('check-node-u1'))
    await waitFor(() =>
      expect(usbPlan).toHaveBeenCalledWith(
        expect.objectContaining({ playlistIds: ['u1'], source: 'traktor' }),
      ),
    )
  })

  it('offers no playlist editing in Traktor without a confirmed collection', async () => {
    openTraktor({ traktorCanSave: vi.fn<Api['traktorCanSave']>().mockResolvedValue(false) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    await screen.findByTestId('source-node-u1')
    expect(screen.queryByTestId('source-tree-new-playlist')).not.toBeInTheDocument()
  })

  it('shows what waits for Traktor to close beside the other queues', async () => {
    openTraktor({
      dj: djReads({
        traktor: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue({
            tracks: 1,
            changes: 0,
            items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'cues' }] }],
          }),
        },
      }),
    })
    await renderApp()
    expect(await screen.findByTestId('traktor-queue-pill')).toHaveTextContent(
      '1 track waits for you to close Traktor',
    )
  })
})

describe('App VirtualDJ tab', () => {
  afterEach(resetCueSession)

  function openVirtualdj(over: ApiOverrides = {}) {
    setApi({
      ...over,
      dj: djReads(
        {
          virtualdj: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
              {
                id: 'Carpeta',
                name: 'Carpeta',
                kind: 'folder',
                count: 1,
                children: [{ id: 'Carpeta/Dentro', name: 'Dentro', kind: 'playlist', count: 2 }],
              },
            ]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
            trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(6),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
              { path: '/m/a.wav', separator: false, meta: {}, contentId: 'virtualdj:/m/a.wav' },
              { path: '/m/b.wav', separator: false, meta: {}, contentId: 'virtualdj:/m/b.wav' },
            ]),
          },
        },
        over.dj,
      ),
    })
  }

  it('shows VirtualDJ in the rail with its folders and lists the tracks of a list', async () => {
    openVirtualdj()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    expect(await screen.findByTestId(`source-node-${ALL_TRACKS_ID}`)).toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta/Dentro'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(window.api.dj.playlist).toHaveBeenCalledWith('virtualdj', 'Carpeta/Dentro')
  })

  it('holds a track of a VirtualDJ list back only for what it lacks, not for coming from VirtualDJ, since VirtualDJ follows it to the new file', async () => {
    openVirtualdj()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta/Dentro'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getByTestId('process-btn')).toHaveAccessibleDescription(
        'Missing required fields: Artist',
      ),
    )
  })

  it('leaves VirtualDJ out of the rail where its library is not found', async () => {
    setApi({
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    await screen.findByTestId('source-rail-rekordbox')
    await waitFor(() => expect(window.api.dj.available).toHaveBeenCalledWith('virtualdj'))
    expect(screen.queryByTestId('source-rail-virtualdj')).toBeNull()
  })

  it('offers no USB export from the VirtualDJ tree on Windows, where Surco has no VirtualDJ exporter', async () => {
    openVirtualdj({ platform: 'win32' })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    expect(await screen.findByTestId('source-tree')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-export-usb')).toBeNull()
  })

  it('opens the USB export from the VirtualDJ tree on its lists on macOS and asks for a VirtualDJ export', async () => {
    const usbPlan = vi
      .fn<Api['usbPlan']>()
      .mockResolvedValue({ ok: false, reason: 'nothing-selected' })
    openVirtualdj({
      platform: 'darwin',
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }),
      usbPlan,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    fireEvent.click(await screen.findByTestId('check-node-Carpeta'))
    await waitFor(() =>
      expect(usbPlan).toHaveBeenCalledWith(
        expect.objectContaining({ playlistIds: ['Carpeta/Dentro'], source: 'virtualdj' }),
      ),
    )
  })

  it('tells the DJ in the VirtualDJ tab that the changes will be saved once VirtualDJ is closed', async () => {
    openVirtualdj({
      dj: djReads({
        virtualdj: { running: vi.fn<ProgramReads['running']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    expect(await screen.findByTestId('source-tree-notice')).toHaveTextContent(
      'VirtualDJ is open. Your changes will be saved when you close it',
    )
  })

  it('offers Auto mark over several VirtualDJ rows, in the section and in the palette, now that Surco saves their cues', async () => {
    openVirtualdj({
      cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) },
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta/Dentro'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    expect(await screen.findByTestId('cues-auto-mark-all')).toBeEnabled()
    expect(screen.queryByTestId('cues-single-only')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    await screen.findByTestId('palette-input')
    expect(document.getElementById('palette-option-cues-auto-mark-selected')).not.toBeNull()
  })

  it('offers Pegar tracklist and Sesión automática on a VirtualDJ folder, now that its lists can be edited', async () => {
    openVirtualdj()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-Carpeta'))
    expect(screen.getByTestId('source-tree-paste-tracklist')).toBeInTheDocument()
    expect(screen.getByTestId('source-tree-session')).toBeInTheDocument()
    expect(screen.getByTestId('source-tree-rename')).toBeInTheDocument()
  })

  async function renameInVirtualdj(nodeId: string, name: string, after: SourceNode[]) {
    let tree: SourceNode[] = [
      {
        id: 'Carpeta',
        name: 'Carpeta',
        kind: 'folder',
        count: 1,
        children: [{ id: 'Carpeta/Dentro', name: 'Dentro', kind: 'playlist', count: 2 }],
      },
    ]
    const playlist = vi
      .fn<ProgramReads['playlist']>()
      .mockResolvedValue([
        { path: '/m/a.wav', separator: false, meta: {}, contentId: 'virtualdj:/m/a.wav' },
      ])
    const editPlaylist = vi.fn<ProgramReads['editPlaylist']>(async () => {
      tree = after
      return { applied: true }
    })
    openVirtualdj({
      dj: djReads({
        virtualdj: { tree: vi.fn<ProgramReads['tree']>(async () => tree), playlist, editPlaylist },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(await screen.findByTestId('source-node-Carpeta/Dentro'))
    await waitFor(() => expect(playlist).toHaveBeenCalledWith('Carpeta/Dentro'))
    fireEvent.contextMenu(screen.getByTestId(`source-node-${nodeId}`))
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    const field = await screen.findByTestId('source-tree-rename-field')
    fireEvent.change(field, { target: { value: name } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
    return playlist
  }

  it('keeps the open VirtualDJ list open under its new name once it is renamed', async () => {
    const playlist = await renameInVirtualdj('Carpeta/Dentro', 'Fuera', [
      {
        id: 'Carpeta',
        name: 'Carpeta',
        kind: 'folder',
        count: 1,
        children: [{ id: 'Carpeta/Fuera', name: 'Fuera', kind: 'playlist', count: 2 }],
      },
    ])
    await waitFor(() =>
      expect(screen.getByTestId('source-node-Carpeta/Fuera')).toHaveAttribute(
        'aria-current',
        'true',
      ),
    )
    expect(playlist).toHaveBeenCalledWith('Carpeta/Fuera')
  })

  it('keeps the open VirtualDJ list open when the folder holding it is renamed', async () => {
    await renameInVirtualdj('Carpeta', 'Cajón', [
      {
        id: 'Cajón',
        name: 'Cajón',
        kind: 'folder',
        count: 1,
        children: [{ id: 'Cajón/Dentro', name: 'Dentro', kind: 'playlist', count: 2 }],
      },
    ])
    await waitFor(() =>
      expect(screen.getByTestId('source-node-Cajón/Dentro')).toHaveAttribute(
        'aria-current',
        'true',
      ),
    )
  })

  it('asks before a tree edit in VirtualDJ too, as in the other programs', async () => {
    const editPlaylist = vi
      .fn<ProgramReads['editPlaylist']>()
      .mockResolvedValue({ applied: true, createdId: 'Carpeta/Nueva' })
    openVirtualdj({ dj: djReads({ virtualdj: { editPlaylist } }) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(screen.getByTestId('source-tree-new-playlist-inside'))
    const input = await screen.findByTestId('source-tree-name')
    fireEvent.change(input, { target: { value: 'Nueva' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
    expect(window.api.dj.askToApply).toHaveBeenCalledExactlyOnceWith(['virtualdj'])
    expect(vi.mocked(window.api.dj.askToApply).mock.invocationCallOrder[0]).toBeLessThan(
      editPlaylist.mock.invocationCallOrder[0],
    )
  })

  it('sends a list made from the VirtualDJ tab to VirtualDJ', async () => {
    const editPlaylist = vi
      .fn<ProgramReads['editPlaylist']>()
      .mockResolvedValue({ applied: true, createdId: 'Carpeta/Nueva' })
    openVirtualdj({ dj: djReads({ virtualdj: { editPlaylist } }) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-virtualdj'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-Carpeta'))
    fireEvent.click(screen.getByTestId('source-tree-new-playlist-inside'))
    const input = await screen.findByTestId('source-tree-name')
    fireEvent.change(input, { target: { value: 'Nueva' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(editPlaylist).toHaveBeenCalledWith(
        { kind: 'create', parentId: 'Carpeta', name: 'Nueva', folder: false },
        'Nueva',
      ),
    )
  })
})

describe('App Serato cues', () => {
  afterEach(resetCueSession)

  function openSerato(over: ApiOverrides = {}) {
    setApi({
      ...over,
      dj: djReads(
        {
          serato: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: 'Friday', name: 'Friday', kind: 'playlist', count: 2 }]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
              { path: '/m/a.wav', separator: false, meta: {}, contentId: 'serato:/m/a.wav' },
              { path: '/m/b.wav', separator: false, meta: {}, contentId: 'serato:/m/b.wav' },
            ]),
          },
        },
        over.dj,
      ),
    })
  }

  async function openFriday() {
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    fireEvent.click(await screen.findByTestId('source-node-Friday'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  async function renameInSerato(nodeId: string, name: string, after: SourceNode[]) {
    let tree: SourceNode[] = [
      {
        id: 'Sets',
        name: 'Sets',
        kind: 'playlist',
        count: 0,
        children: [{ id: 'Sets%%Friday', name: 'Friday', kind: 'playlist', count: 2 }],
      },
    ]
    const playlist = vi
      .fn<ProgramReads['playlist']>()
      .mockResolvedValue([
        { path: '/m/a.wav', separator: false, meta: {}, contentId: 'serato:/m/a.wav' },
      ])
    const editPlaylist = vi.fn<ProgramReads['editPlaylist']>(async () => {
      tree = after
      return { applied: true }
    })
    openSerato({
      dj: djReads({
        serato: { tree: vi.fn<ProgramReads['tree']>(async () => tree), playlist, editPlaylist },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    fireEvent.click(await screen.findByTestId('source-node-expand-Sets'))
    fireEvent.click(await screen.findByTestId('source-node-Sets%%Friday'))
    await waitFor(() => expect(playlist).toHaveBeenCalledWith('Sets%%Friday'))
    fireEvent.contextMenu(screen.getByTestId(`source-node-${nodeId}`))
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    const field = await screen.findByTestId('source-tree-rename-field')
    fireEvent.change(field, { target: { value: name } })
    fireEvent.keyDown(field, { key: 'Enter' })
    await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
    return playlist
  }

  it('asks before a tree edit in Serato too, as in the other programs', async () => {
    await renameInSerato('Sets%%Friday', 'Saturday', [
      {
        id: 'Sets',
        name: 'Sets',
        kind: 'playlist',
        count: 0,
        children: [{ id: 'Sets%%Saturday', name: 'Saturday', kind: 'playlist', count: 2 }],
      },
    ])
    expect(window.api.dj.askToApply).toHaveBeenCalledExactlyOnceWith(['serato'])
  })

  it('offers pasting a tracklist into a Serato crate, since Surco reads the whole Serato collection to find the tracks', async () => {
    openSerato()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-Friday'))
    expect(screen.getByTestId('source-tree-paste-tracklist')).toBeInTheDocument()
  })

  it('keeps the open Serato subcrate open under its new name once it is renamed', async () => {
    const playlist = await renameInSerato('Sets%%Friday', 'Sábado', [
      {
        id: 'Sets',
        name: 'Sets',
        kind: 'playlist',
        count: 0,
        children: [{ id: 'Sets%%Sábado', name: 'Sábado', kind: 'playlist', count: 2 }],
      },
    ])
    await waitFor(() =>
      expect(screen.getByTestId('source-node-Sets%%Sábado')).toHaveAttribute(
        'aria-current',
        'true',
      ),
    )
    expect(playlist).toHaveBeenCalledWith('Sets%%Sábado')
  })

  it('keeps the open Serato subcrate open when the crate holding it is renamed', async () => {
    await renameInSerato('Sets', 'Gigs', [
      {
        id: 'Gigs',
        name: 'Gigs',
        kind: 'playlist',
        count: 0,
        children: [{ id: 'Gigs%%Friday', name: 'Friday', kind: 'playlist', count: 2 }],
      },
    ])
    await waitFor(() =>
      expect(screen.getByTestId('source-node-Gigs%%Friday')).toHaveAttribute(
        'aria-current',
        'true',
      ),
    )
  })

  it('opens the cue editor on a row of a Serato crate in Serato’s words, and keeps the track from being converted', async () => {
    const read = vi.fn<Api['cues']['trackCues']>().mockResolvedValue({
      contentId: 'serato:/m/b.wav',
      analysed: false,
      grid: [],
      strong: [],
      phrases: [],
      cues: [{ id: '0', ms: 1000, kind: 1, color: 1 }],
      wave: null,
      durationMs: 60000,
      fingerprint: 'f0',
      gridFingerprint: '',
    })
    openSerato({
      cues: {
        trackCues: read,
        queued: vi.fn<Api['cues']['queued']>().mockResolvedValue(null),
      },
    })
    await openFriday()
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(read).toHaveBeenCalledWith('serato:/m/b.wav'))
    expect(await screen.findByTestId('cues-unanalysed')).toHaveTextContent(
      'Serato has not analysed this track yet',
    )
    expect(screen.getByTestId('process-btn')).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('process-btn')).toHaveAccessibleDescription(
      'Serato would lose the track and its cues',
    )
  })

  it('offers no USB export from the Serato tree on Windows, where Surco has no Serato exporter', async () => {
    openSerato({ platform: 'win32' })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    expect(await screen.findByTestId('source-tree')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-export-usb')).toBeNull()
  })

  it('opens the USB export from the Serato tree on its crates on macOS and asks for a Serato export', async () => {
    const usbPlan = vi
      .fn<Api['usbPlan']>()
      .mockResolvedValue({ ok: false, reason: 'nothing-selected' })
    openSerato({
      platform: 'darwin',
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }),
      usbPlan,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    fireEvent.click(await screen.findByTestId('check-node-Friday'))
    await waitFor(() =>
      expect(usbPlan).toHaveBeenCalledWith(
        expect.objectContaining({ playlistIds: ['Friday'], source: 'serato' }),
      ),
    )
  })

  it('tells the DJ in the Serato tab that the changes wait for Serato to close', async () => {
    openSerato({
      dj: djReads({
        serato: { running: vi.fn<ProgramReads['running']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    expect(await screen.findByTestId('source-tree-notice')).toHaveTextContent(
      'Serato is open. Your changes will be saved when you close it',
    )
  })

  it('keeps the Serato warning off another program’s tab, even while Serato is still open', async () => {
    openSerato({
      dj: djReads({
        serato: { running: vi.fn<ProgramReads['running']>().mockResolvedValue(true) },
        traktor: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'u1', name: 'Saturday', kind: 'playlist', count: 0 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    await screen.findByTestId('source-tree-notice')
    fireEvent.click(screen.getByTestId('source-rail-traktor'))
    await screen.findByTestId('source-node-u1')
    expect(screen.queryByTestId('source-tree-notice')).toBeNull()
  })

  it('says nothing in Traktor’s tab while Traktor is open, since its changes wait in its own queue', async () => {
    const traktorRunning = vi.fn<ProgramReads['running']>().mockResolvedValue(true)
    openSerato({
      dj: djReads({
        serato: { running: vi.fn<ProgramReads['running']>().mockResolvedValue(true) },
        traktor: {
          running: traktorRunning,
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'u1', name: 'Saturday', kind: 'playlist', count: 0 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-traktor'))
    await screen.findByTestId('source-node-u1')
    expect(screen.queryByTestId('source-tree-notice')).toBeNull()
    expect(traktorRunning).not.toHaveBeenCalled()
  })

  it('shows no warning in the Serato tab once Serato answers it is closed', async () => {
    let answer: (running: boolean) => void = () => {}
    const seratoRunning = vi.fn<ProgramReads['running']>(
      () => new Promise<boolean>((resolve) => (answer = resolve)),
    )
    openSerato({ dj: djReads({ serato: { running: seratoRunning } }) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    await screen.findByTestId('source-node-Friday')
    await waitFor(() => expect(seratoRunning).toHaveBeenCalled())
    await act(async () => answer(false))
    expect(screen.queryByTestId('source-tree-notice')).toBeNull()
  })

  it('offers Auto mark over several Serato rows, as over any other program’s', async () => {
    openSerato({ cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) } })
    await openFriday()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    expect(await screen.findByTestId('cues-auto-mark-all')).toBeInTheDocument()
  })

  it('marks a Serato row whose cues wait for Serato to close', async () => {
    openSerato({
      dj: djReads({
        serato: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue({
            tracks: 1,
            changes: 0,
            items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'cues' }] }],
          }),
        },
      }),
    })
    await openFriday()
    await waitFor(() =>
      expect(screen.getAllByTestId('track-wave')[0]).toHaveAttribute('data-pending', 'true'),
    )
    expect(screen.getAllByTestId('track-wave')[1]).not.toHaveAttribute('data-pending')
  })

  it('watches the Serato queue from the start and shows what waits for Serato to close', async () => {
    const seratoCueQueueReady = vi.fn<ProgramReads['cueQueueReady']>().mockResolvedValue(undefined)
    openSerato({
      dj: djReads({
        serato: {
          cueQueueReady: seratoCueQueueReady,
          cueQueue: vi.fn<ProgramReads['cueQueue']>().mockResolvedValue({
            tracks: 1,
            changes: 0,
            items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'cues' }] }],
          }),
        },
      }),
    })
    await renderApp()
    expect(await screen.findByTestId('serato-queue-pill')).toHaveTextContent(
      '1 track waits for you to close Serato',
    )
    expect(seratoCueQueueReady).toHaveBeenCalled()
  })
})

describe('App Serato crate move', () => {
  const B: SourceNode = { id: 'A%%B', name: 'B', kind: 'playlist', count: 1 }
  const BEFORE: SourceNode[] = [
    { id: 'A', name: 'A', kind: 'playlist', count: 0, children: [B] },
    { id: 'D', name: 'D', kind: 'playlist', count: 0 },
  ]
  const AFTER: SourceNode[] = [
    { id: 'A', name: 'A', kind: 'playlist', count: 0 },
    { id: 'D', name: 'D', kind: 'playlist', count: 0, children: [{ ...B, id: 'D%%B' }] },
  ]

  async function dropBIntoD(answer: RekordboxEditResult) {
    let settle: (result: RekordboxEditResult) => void = () => {}
    let tree = BEFORE
    const loadSeratoPlaylist = vi
      .fn<ProgramReads['playlist']>()
      .mockResolvedValue([
        { path: '/m/a.wav', separator: false, meta: {}, contentId: 'serato:/m/a.wav' },
      ])
    const editSerato = vi.fn<ProgramReads['editPlaylist']>(
      () =>
        new Promise((resolve) => {
          settle = (result) => {
            if (result.applied) tree = AFTER
            resolve(result)
          }
        }),
    )
    setApi({
      dj: djReads({
        serato: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi.fn<ProgramReads['tree']>(async () => tree),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: loadSeratoPlaylist,
          editPlaylist: editSerato,
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-serato'))
    fireEvent.click(await screen.findByTestId('source-node-expand-A'))
    fireEvent.click(await screen.findByTestId('source-node-A%%B'))
    await waitFor(() => expect(loadSeratoPlaylist).toHaveBeenCalledWith('A%%B'))
    const dt = fakeDataTransfer()
    fireEvent.dragStart(screen.getByTestId('source-node-A%%B'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('source-node-D'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('source-node-D'), { dataTransfer: dt })
    await waitFor(() => expect(editSerato).toHaveBeenCalled())
    expect(loadSeratoPlaylist).not.toHaveBeenCalledWith('D%%B')
    await act(async () => settle(answer))
    return loadSeratoPlaylist
  }

  it('opens the moved crate under its new name once Serato has written it, not before', async () => {
    await dropBIntoD({ applied: true })
    await waitFor(() =>
      expect(screen.getByTestId('source-node-D%%B')).toHaveAttribute('aria-current', 'true'),
    )
  })

  it('opens no crate under the new name when Serato refuses the move', async () => {
    const load = await dropBIntoD({ applied: false, reason: 'bad-name' })
    await waitFor(() => expect(screen.getByTestId('source-node-A%%B')).toBeInTheDocument())
    expect(screen.queryByTestId('source-node-D%%B')).toBeNull()
    expect(load).not.toHaveBeenCalledWith('D%%B')
  })
})

describe('App sidebar clipping', () => {
  it('clips the sidebar so the player cannot animate into page scroll', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('sidebar').className).toContain('overflow-hidden')
  })

  // VoiceOver's landmark rotor listed the column as a bare "complementary", with nothing to
  // tell it apart; its name is what lets a screen reader user jump straight to the tracks.
  it('names the sidebar landmark', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByRole('complementary', { name: i18n.t('common.trackList') })).toBe(
      screen.getByTestId('sidebar'),
    )
  })
})

describe('App sidebar divider', () => {
  // Hover the divider and let the tooltip's delay elapse; the portal tooltip only mounts
  // once the delay fires, so the assertion reads it after advancing the timer.
  function hoverDivider(): void {
    // The sidebar divider is the first separator; a second appears next to the editor
    // once a track is open.
    const divider = screen.getAllByRole('separator')[0]
    fireEvent.pointerEnter(divider)
    fireEvent.pointerMove(divider, { clientX: 10, clientY: 10 })
    act(() => vi.advanceTimersByTime(500))
  }

  // An empty column beside the empty-screen card read as a second, broken screen, and lit
  // up on its own while files were dragged in. Until there is a track the window is one
  // screen: no column, no divider to drag between nothing and the card.
  it('draws no list column nor divider while the list is empty, and both once tracks arrive', async () => {
    await renderApp()
    expect(await screen.findByTestId('add-files')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    await addTwoTracks()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getAllByRole('separator').length).toBeGreaterThan(0)
  })

  it('asks to pick a track, not to drop files, beside a loaded list with nothing selected, and a click there opens no file dialog', async () => {
    setApi({ getPathForFile: vi.fn(() => '/music/c.wav') })
    await renderApp()
    expect(await screen.findByTestId('add-files')).toBeInTheDocument()
    await addTwoTracks()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByTestId('source-pick-track')).toHaveTextContent(
      i18n.t('sources.pickTrack'),
    )
    expect(within(screen.getByRole('main')).queryByTestId('add-files')).toBeNull()
    vi.mocked(window.api.pickFiles).mockClear()
    fireEvent.click(screen.getByTestId('empty-dropzone'))
    await act(async () => {})
    expect(window.api.pickFiles).not.toHaveBeenCalled()
    fireEvent.drop(screen.getByTestId('empty-dropzone'), {
      dataTransfer: fakeDataTransfer([new File([''], 'c.wav')]),
    })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
  })

  it('offers the fit hint once the list has tracks', async () => {
    await renderApp()
    await addTwoTracks()
    vi.useFakeTimers()
    try {
      hoverDivider()
      expect(screen.getByRole('tooltip')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App column widths', () => {
  const initialWidth = window.innerWidth
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
  })
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth })
  })

  it('sizes the list as a share of the window, so a wider window gives every column room', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('sidebar')).toHaveStyle({ width: '348px' })
  })

  it('saves the dragged list width as a share of the window, not as pixels', async () => {
    const saveSettings = vi.fn<Api['saveSettings']>().mockResolvedValue(settings())
    setApi({ saveSettings })
    await renderApp()
    await addTwoTracks()
    const at = (event: Event, clientX: number): Event =>
      Object.defineProperty(event, 'clientX', { value: clientX })
    const divider = screen.getAllByRole('separator')[0]
    fireEvent(divider, at(createEvent.pointerDown(divider), 350))
    fireEvent(window, at(createEvent.pointerMove(window), 400))
    fireEvent(window, at(createEvent.pointerUp(window), 400))
    const saved = saveSettings.mock.calls.find(([patch]) => patch.columnShares)?.[0]
    expect(saved?.columnShares?.list).toBeCloseTo((400 * 0.83) / 1202)
    expect(saved?.resultsWidth).toBeUndefined()
  })

  it('reads the saved share back, whatever pixel width an older version stored', async () => {
    setApi({
      getSettings: vi
        .fn<Api['getSettings']>()
        .mockResolvedValue(settings({ resultsWidth: 385, columnShares: { list: 0.3 } })),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() =>
      expect(screen.getByTestId('sidebar')).toHaveStyle({
        width: `${Math.round((1202 * 0.3) / 0.83)}px`,
      }),
    )
  })
})

describe('App results column fold', () => {
  function withEngine(over: ApiOverrides = {}): ReturnType<typeof vi.fn> {
    const saveSettings = vi.fn((patch: Partial<Settings>) =>
      Promise.resolve({ ...settings(), ...patch }),
    )
    setApi({
      saveSettings,
      ...over,
      dj: djReads(
        {
          engine: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 2 }]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
              { path: '/m/a.wav', separator: false, meta: {}, contentId: 'engine:11' },
              { path: '/m/b.wav', separator: false, meta: {}, contentId: 'engine:12' },
            ]),
          },
        },
        over.dj,
      ),
    })
    return saveSettings
  }

  async function openFridayRow(): Promise<void> {
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
  }

  // The DJ who never tags from a DJ tab folds the column there once; the user who fills
  // missing metadata from Tracks must still find it open. So the fold belongs to the tab.
  it('remembers the fold per tab, leaving the Tracks tab with its results column', async () => {
    const saveSettings = withEngine()
    await renderApp()
    await addTwoTracks()
    await openFridayRow()
    fireEvent.click(await screen.findByTestId('results-fold'))
    expect(saveSettings).toHaveBeenCalledWith({ foldedResults: { engine: true } })
    expect(screen.queryByTestId('matches-column')).toBeNull()
    expect(screen.getByTestId('results-strip')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    expect(await screen.findByTestId('matches-column')).toBeInTheDocument()
  })

  // ⌘2 jumps to the results column; folded, the jump would land nowhere, so it opens it.
  it('unfolds the column when the jump-to-results shortcut aims at it', async () => {
    const saveSettings = withEngine({
      getSettings: vi
        .fn<Api['getSettings']>()
        .mockResolvedValue(settings({ foldedResults: { engine: true } })),
    })
    await renderApp()
    await addTwoTracks()
    await openFridayRow()
    expect(await screen.findByTestId('results-strip')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })
    expect(saveSettings).toHaveBeenCalledWith({ foldedResults: { engine: false } })
    expect(await screen.findByTestId('matches-column')).toBeInTheDocument()
  })
  // "Search Discogs" from a row's menu promises a search box with the cursor in it.
  it('unfolds the column for a row menu search and puts the cursor in its box', async () => {
    const saveSettings = withEngine({
      getSettings: vi
        .fn<Api['getSettings']>()
        .mockResolvedValue(settings({ foldedResults: { engine: true } })),
    })
    await renderApp()
    await addTwoTracks()
    await openFridayRow()
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
    fireEvent.click(await screen.findByTestId('track-menu-search'))
    expect(saveSettings).toHaveBeenCalledWith({ foldedResults: { engine: false } })
    await waitFor(() => expect(screen.getByTestId('discogs-query')).toHaveFocus())
  })
})

describe('App auto-match in a DJ library tab', () => {
  const release: Release = {
    provider: 'discogs',
    id: 1,
    title: 'Album',
    artists: [{ name: 'Artist' }],
    tracklist: [
      { position: '1', title: 'Alpha', duration: '3:00' },
      { position: '2', title: 'Bravo', duration: '3:00' },
    ],
  }

  function withEngine(search: Api['search']): void {
    setApi({
      getSettings: vi
        .fn<Api['getSettings']>()
        .mockResolvedValue(
          settings({ discogsToken: 'tok', autoMatch: true, foldedResults: { engine: true } }),
        ),
      readTags: vi.fn((path: string) =>
        Promise.resolve({ title: path === '/m/a.wav' ? 'Alpha' : 'Bravo', artist: 'Artist' }),
      ),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 2 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
            { path: '/m/a.wav', separator: false, meta: {}, contentId: 'engine:11' },
            { path: '/m/b.wav', separator: false, meta: {}, contentId: 'engine:12' },
          ]),
        },
      }),
    })
  }

  async function openFriday(): Promise<void> {
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  // A DJ's playlist is already tagged by hand. Probing every row of a library on open spent
  // the Discogs rate limit and CPU on tracks nobody wanted matched, so only a press does.
  it('sends no Discogs search when a library playlist opens and a row is selected', async () => {
    const search = vi
      .fn<Api['search']>()
      .mockResolvedValue([{ provider: 'discogs', id: 1, title: 'Artist - Album' }])
    withEngine(search)
    await openFriday()
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900))
    })

    expect(search).not.toHaveBeenCalled()
    expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0)
  })

  // With one row picked, the button means that row: matching the whole playlist instead
  // would rewrite tags the DJ never pointed at.
  it('matches only the selected row when the button is pressed in a library tab', async () => {
    const search = vi
      .fn<Api['search']>()
      .mockResolvedValue([{ provider: 'discogs', id: 1, title: 'Artist - Album' }])
    withEngine(search)
    await openFriday()
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('auto-match'))

    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect(JSON.stringify(search.mock.calls)).toContain('Alpha')
    expect(JSON.stringify(search.mock.calls)).not.toContain('Bravo')
  })
})

describe('App quality triage', () => {
  // The "analyze quality" sweep exists to triage a whole dropped crate for fake-lossless
  // rips at once: every track gets measured and flagged with a verdict dot, so the user
  // never has to open each one. This is the behaviour the spectrum data layer must keep.
  it('measures every track and flags each with a quality verdict on demand', async () => {
    await renderApp()
    await addTwoTracks()
    runMenu('analyze-quality')
    await waitFor(() => expect(screen.getAllByTestId('track-quality')).toHaveLength(2))
  })

  // Hovering a track warms its spectrum so its quality verdict shows in the list without
  // the user opening it — the prefetch that hides the ffmpeg latency behind the cursor.
  it('warms a hovered track so its verdict appears without opening it', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(within(rows[1]).getByTestId('track-quality')).toBeInTheDocument())
  })

  // Folding the Audio quality section away is the user's "stop analysing this" — but the
  // hover prefetch warmed the spectrum regardless, so collapsing the section still ran
  // the heavy ffmpeg decode behind every rested hover. With the section folded, hovering
  // a track must skip the spectrogram (the waveform, always shown by the player, still
  // warms) so folding actually stops the analysis.
  it('skips the spectrum prefetch for a hovered track while the quality section is folded', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    const waveform = vi.fn().mockResolvedValue(wave)
    setApi({ spectrogram, waveform })
    await renderApp()
    const rows = await addTwoTracks()
    // Open the editor on the first track, then collapse its Audio quality section.
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Audio quality' }))
    // The waveform prefetch always runs on hover, so its call marks the moment the
    // (debounced) prefetch body executed — at which point the spectrogram must be untouched.
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav', 'high'))
    expect(spectrogram).not.toHaveBeenCalledWith('/music/b.wav')
  })

  it('stops warming a row once the cursor or focus moves on to another', async () => {
    const waveform = vi.fn(() => new Promise(() => {}))
    const cancelAnalysis = vi.fn().mockResolvedValue(undefined)
    setApi({ waveform, cancelAnalysis })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav', 'high'))
    fireEvent.mouseEnter(rows[0])
    await waitFor(() => expect(cancelAnalysis).toHaveBeenCalledWith('/music/b.wav'))
  })

  it('never stops the analysis of the selected track when the cursor moves off it', async () => {
    const waveform = vi.fn(() => new Promise(() => {}))
    const cancelAnalysis = vi.fn().mockResolvedValue(undefined)
    setApi({ waveform, cancelAnalysis })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav', 'high'))
    fireEvent.mouseEnter(rows[0])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/a.wav', 'high'))
    expect(cancelAnalysis).not.toHaveBeenCalledWith('/music/b.wav')
  })

  // The player's waveform is the slowest decode (it reads the whole file) and only
  // mounts when playback starts, so without warming it the player opens to an empty
  // strip for seconds. Hovering the row a DJ is about to play primes that decode.
  it('warms a hovered track so its waveform is decoded before playback opens it', async () => {
    const waveform = vi.fn().mockResolvedValue(wave)
    setApi({ waveform })
    const client = await renderApp()
    const rows = await addTwoTracks()
    fireEvent.mouseEnter(rows[1])
    await waitFor(() => expect(waveform).toHaveBeenCalledWith('/music/b.wav', 'high'))
    expect(client.getQueryData(['waveform', '/music/b.wav'])).toEqual(wave)
  })

  it('keeps the analyze sweep going behind a DJ program instead of parking it', async () => {
    // Both the analyze sweep and the editor's cover well subscribe to window focus, so
    // the mock fans the event out to every listener instead of keeping only the last.
    const focusListeners: ((focused: boolean) => void)[] = []
    const setFocus = (focused: boolean): void => {
      for (const cb of focusListeners) cb(focused)
    }
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    const djAppRunning = vi.fn<Api['djAppRunning']>().mockResolvedValue(true)
    setApi({
      spectrogram,
      djAppRunning,
      onWindowFocus: (cb: (focused: boolean) => void) => {
        focusListeners.push(cb)
        return () => {}
      },
    })
    await renderApp()
    await addTwoTracks()
    // Let the selected track's editor warm its own spectrum first; the sweep is what
    // we're gating, so we measure new ffmpeg calls against that baseline.
    await new Promise((r) => setTimeout(r, 0))

    setFocus(false)
    await waitFor(() => expect(djAppRunning).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    const baseline = spectrogram.mock.calls.length
    runMenu('analyze-quality')

    await waitFor(() => expect(spectrogram.mock.calls.length).toBeGreaterThan(baseline))
  })

  // With autoAnalyze on, importing must warm every heavy analysis on disk — not just the
  // spectrum the old prefetch warmed — so reopening the crate never re-decodes. loudness is
  // one of the sweep-only probes, so its call proves the full sweep ran, not the old path.
  it('runs the full analysis sweep on import when autoAnalyze is on', async () => {
    const loudness = vi.fn().mockResolvedValue(null)
    setApi({
      loudness,
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => {
      const paths = loudness.mock.calls.map((c) => c[0]).sort()
      expect(paths).toEqual(['/music/a.wav', '/music/b.wav'])
    })
  })

  it('holds the auto-analysis sweep until every read of the import lands, then runs every pass on each track, even the one whose spectrum the editor already measured', async () => {
    let releaseB: () => void = () => {}
    const bRead = new Promise<void>((r) => {
      releaseB = r
    })
    const loudness = vi.fn().mockResolvedValue(null)
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    setApi({
      loudness,
      spectrogram,
      readTags: vi.fn(async (path: string) => {
        if (path === '/music/b.wav') await bRead
        return { title: path === '/music/a.wav' ? 'Song A' : 'Song B', artist: 'Artist' }
      }),
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByText('Song A').length).toBeGreaterThan(0))
    await waitFor(() => expect(spectrogram).toHaveBeenCalledWith('/music/a.wav', 'high'))
    expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull()
    expect(loudness).not.toHaveBeenCalled()

    releaseB()
    await waitFor(() => {
      const paths = loudness.mock.calls.map((c) => c[0]).sort()
      expect(paths).toEqual(['/music/a.wav', '/music/b.wav'])
    })
  })

  it('drops the held tracks when auto-analyze is turned off before the import settles, since the user just said not to decode them', async () => {
    let releaseB: () => void = () => {}
    const bRead = new Promise<void>((r) => {
      releaseB = r
    })
    const loudness = vi.fn().mockResolvedValue(null)
    const base = settings({ autoAnalyze: true })
    setApi({
      platform: 'darwin',
      loudness,
      readTags: vi.fn(async (path: string) => {
        if (path === '/music/b.wav') await bRead
        return { title: path === '/music/a.wav' ? 'Song A' : 'Song B', artist: 'Artist' }
      }),
      getSettings: vi.fn().mockResolvedValue(base),
      saveSettings: vi.fn((patch) => Promise.resolve({ ...base, ...patch })),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByText('Song A').length).toBeGreaterThan(0))
    fireEvent.click(screen.getByTestId('open-settings'))
    fireEvent.click(await screen.findByTestId('settings-tab-editor'))
    fireEvent.click(screen.getByTestId('settings-auto-analyze'))
    fireEvent.click(screen.getByTestId('settings-close'))
    await waitFor(() => expect(screen.queryByTestId('settings-close')).toBeNull())
    await waitFor(() =>
      expect(window.api.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ autoAnalyze: false }),
      ),
    )

    releaseB()
    await waitFor(() => expect(screen.getAllByText('Song B').length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.queryByTestId('sweep-icon-import')).toBeNull())
    expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull()
    expect(loudness).not.toHaveBeenCalled()
  })
})

// The full release date setting promises to show and save the whole date whenever the file
// has one, on every row: a row read before the change kept the old year and saved it over the
// file on convert. A year the user typed is theirs, so the setting never rewrites it.
describe('App full release date setting', () => {
  it('re-dresses the rows already read when it changes, but not a year the user typed', async () => {
    const base = settings({ visibleFields: ['title', 'artist', 'year'] })
    setApi({
      readMeta: vi.fn(async (path: string) => ({
        tags: { title: path === '/music/a.wav' ? 'Song A' : 'Song B', artist: 'X', year: '2020' },
        duration: 180,
        cover: null,
        foreignTags: [],
        fileDate: '2020-12-01',
      })),
      getSettings: vi.fn().mockResolvedValue(base),
      saveSettings: vi.fn((patch) => Promise.resolve({ ...base, ...patch })),
    })
    await renderApp()
    const rows = await addTwoTracks()
    await waitFor(() => expect(screen.getByTestId('field-year')).toHaveValue('2020'))
    fireEvent.click(rows[1])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Song B'))
    fireEvent.change(screen.getByTestId('field-year'), { target: { value: '1999' } })

    fireEvent.click(screen.getByTestId('open-settings'))
    fireEvent.click(await screen.findByTestId('settings-tab-editor'))
    fireEvent.click(screen.getByTestId('settings-full-release-date'))
    fireEvent.click(screen.getByTestId('settings-close'))
    await waitFor(() => expect(screen.queryByTestId('settings-close')).toBeNull())

    await waitFor(() => expect(screen.getByTestId('field-year')).toHaveValue('1999'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-year')).toHaveValue('2020-12-01'))
  })
})

describe('App auto-match', () => {
  // Auto-match exists to tag a crate from Discogs without a click per track: the toolbar
  // sweep searches each file, and when a release matches confidently it applies the
  // metadata outright and badges the row so the user can spot-check what was filled. This
  // is the end-to-end wiring (button → headless probe → apply → badge) that must hold.
  // `provider` is required and carries weight: matchStatKey reads it to tally the match
  // under Discogs, Bandcamp or Deezer, and autoMatch branches on it. Leaving it off gave
  // every test an undefined that fell through matchStatKey's default to 'discogsMatches',
  // so a bug miscounting a Bandcamp or Deezer match would have read as correct here.
  const release: Release = {
    provider: 'discogs',
    id: 1,
    title: 'Album',
    artists: [{ name: 'Artist' }],
    tracklist: [{ position: '1', title: 'My Song', duration: '3:00' }],
  }

  it('applies a confident Discogs match unattended and flags the row', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    const getRelease = vi.fn().mockResolvedValue(release)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      // A title + duration the release agrees with scores 'high', the bar for applying.
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    expect(search).toHaveBeenCalled()
  })

  // Hovering a track warms the Discogs search the editor is about to run. It has to warm the
  // same search: without the artist and title the panel and the sweep send, it ran the
  // free-text ladder under cache keys nobody then read, spending the rate limit twice.
  it('warms the same Discogs search the editor runs for a hovered track', async () => {
    const search = vi.fn().mockResolvedValue([])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
    })
    await renderApp()
    const rows = await addTwoTracks()
    await waitFor(() => expect(within(rows[0]).getByText('My Song')).toBeInTheDocument())

    fireEvent.mouseEnter(rows[0])

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        'low',
        expect.objectContaining({ artist: 'Artist', title: 'My Song' }),
      ),
    )
  })

  // The toolbar sweep honours the active format filter: filter to MP3 and only the visible mp3
  // rows are probed, never the hidden wav. Otherwise a DJ narrowing to one format would still
  // fire Discogs calls (and write matches) for the tracks the filter is hiding.
  it('auto-matches only the visible rows when a format filter is active', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Narrow to MP3 — only the mp3 row shows.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('auto-match'))
    // Only the single visible mp3 gets matched; the hidden wav is never swept in.
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-clear'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getAllByTestId('track-automatched')).toHaveLength(1)
  })

  // Bandcamp needs no token, so a Bandcamp-only DJ has everything the sweep needs; greying
  // the button out over a Discogs token they will never use made the feature unreachable.
  it('enables the button without a token when Discogs is not a source', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ searchProviders: ['bandcamp'] })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getByTestId('auto-match')).toBeEnabled())
  })

  it('sends the button to the Search settings when Discogs has no token, instead of greying it out unexplained', async () => {
    setApi({
      platform: 'darwin',
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()
    const button = screen.getByTestId('auto-match')
    expect(button).toHaveAccessibleName(i18n.t('header.autoMatchNoToken'))
    fireEvent.click(button)
    expect(await screen.findByTestId('settings-tab-search')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  // Auto-match on import runs the whole drop unattended: a folder of a thousand files is
  // left alone and must finish, so no row waits for the user to scroll it into view. Here
  // nothing is ever reported visible and both rows still match.
  it('auto-matches every imported track without waiting for its row to be on screen', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()

    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
  })

  // The sweep runs on its own in the background; it is no step the DJ took. A Reviewed they
  // just pressed keeps ⌘Z while its notice is up, whatever the sweep matched meanwhile.
  it('leaves ⌘Z with a live Reviewed when a background auto-match lands', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    })
    await renderApp()
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undoReviewed).toHaveBeenCalledOnce()
    takeShortcutUndo()
  })

  // The track you're looking at shouldn't need the toolbar button: with auto-match on,
  // once the selection rests on a row it gets matched even if it was never scrolled into
  // view (the import gating only holds back the rows you aren't looking at).
  it('auto-matches the selected track without the toolbar button', async () => {
    const search = vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }])
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok', autoMatch: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search,
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()

    // No row is scrolled into view; only the rested selection drives the match.
    await waitFor(
      () => expect(screen.getAllByTestId('track-automatched').length).toBeGreaterThan(0),
      {
        timeout: 2000,
      },
    )
    expect(search).toHaveBeenCalled()
  })

  it('leaves an undone auto-match undone when the user comes back to the track, so ⌘Z is not overruled by the sweep or the editor', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(
        settings({
          discogsToken: 'tok',
          autoMatch: true,
          visibleFields: ['title', 'artist', 'album'],
        }),
      ),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(release),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())
    await waitFor(() => expect(screen.getByTestId('field-album')).toHaveValue('Album'))

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0))
    expect(screen.getByTestId('field-album')).toHaveValue('')

    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700))
    })
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900))
    })

    expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0)
    expect(screen.getByTestId('field-album')).toHaveValue('')
  })

  // One row's malformed Discogs payload (a release without a tracklist) must skip
  // that track, not sink the sweep: the other rows still match, the progress pill
  // still completes, and nothing escapes as an unhandled rejection.
  it('survives a malformed release and still matches the remaining tracks', async () => {
    const getRelease = vi
      .fn()
      .mockResolvedValueOnce({ id: 1, title: 'Album' })
      .mockResolvedValue(release)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect(screen.queryByTestId('app-error')).toBeNull()
  })

  // The sweep probes a snapshot of each track while the list stays fully editable. An
  // edit typed during a track's probe window must win over the match landing after it —
  // otherwise the user's words silently revert to Discogs's a few seconds later.
  it('never overwrites an edit typed while that track was being probed', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((res) => {
      releaseGate = res
    })
    const getRelease = vi.fn(async () => {
      await gate
      return release
    })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease,
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(getRelease).toHaveBeenCalled())

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    releaseGate()

    // The untouched second track still matches; the edited one is left alone.
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
  })

  // The DJ typed the album of a white label they know better than any catalog; the next
  // sweep must fill the tracks nobody touched and leave that one exactly as typed.
  describe('a track edited by hand', () => {
    const handApi = (paths = ['/music/a.wav', '/music/b.wav']) => {
      const getRelease = vi.fn<Api['getRelease']>().mockResolvedValue(release)
      setApi({
        getSettings: vi.fn().mockResolvedValue(
          settings({
            discogsToken: 'tok',
            visibleFields: ['title', 'artist', 'album', 'trackNumber', 'comment'],
          }),
        ),
        pickFiles: vi.fn().mockResolvedValue(paths),
        readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
        readDuration: vi.fn().mockResolvedValue(180),
        search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
        getRelease,
      })
    }
    const typeField = async (name: string, value: string) => {
      const field = await screen.findByTestId(`field-${name}`)
      fireEvent.focus(field)
      fireEvent.change(field, { target: { value } })
      fireEvent.keyDown(field, { key: 'Enter' })
      fireEvent.blur(field)
    }
    const typeAlbum = (value: string) => typeField('album', value)
    const fieldOfRow = async (index: number, name: string) => {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() => expect(screen.getByTestId(`field-${name}`)).toBeInTheDocument())
      return (screen.getByTestId(`field-${name}`) as HTMLInputElement).value
    }
    const albumOfRow = (index: number) => fieldOfRow(index, 'album')

    it('keeps its typed album through the sweep while the other track is matched', async () => {
      handApi()
      await renderApp()
      await addTwoTracks()
      await typeAlbum('Hand Typed')

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())

      expect(await albumOfRow(0)).toBe('Hand Typed')
      expect(await albumOfRow(1)).toBe('Album')
    })

    it('keeps an album typed for a whole selection through the sweep', async () => {
      handApi(['/music/a.wav', '/music/b.wav', '/music/c.wav'])
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      await typeAlbum('Hand Typed')
      fireEvent.click(rows[2])

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())

      expect(await albumOfRow(0)).toBe('Hand Typed')
      expect(await albumOfRow(1)).toBe('Hand Typed')
      expect(await albumOfRow(2)).toBe('Album')
    })

    // Numbering a selection is the album fix for a rip with no release behind it: the
    // sweep must not swap those numbers for a release's tracklist positions.
    it('keeps the numbers a selection was given through the sweep', async () => {
      handApi(['/music/a.wav', '/music/b.wav', '/music/c.wav'])
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      runMenu('number-tracks')
      expect(
        await screen.findByText(i18n.t('notices.numberedTracks', { count: 2 })),
      ).toBeInTheDocument()
      fireEvent.click(rows[2])

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())

      expect(await fieldOfRow(0, 'trackNumber')).toBe('1')
      expect(await fieldOfRow(1, 'trackNumber')).toBe('2')
      expect(await albumOfRow(0)).toBe('')
      expect(await albumOfRow(1)).toBe('')
    })

    // Clearing hands a track back to the sweep only until the DJ types into it again: the
    // search it kept still finds the old release, which would land over the retyped tags.
    it('keeps what was typed after a clear through the sweep', async () => {
      handApi()
      await renderApp()
      await addTwoTracks()
      fireEvent.click(await screen.findByTestId('clear-meta-btn'))
      await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue(''))
      await typeField('title', 'My Song')
      await typeField('artist', 'Hand Artist')
      await typeAlbum('Hand Album')

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())

      expect(await fieldOfRow(0, 'artist')).toBe('Hand Artist')
      expect(await albumOfRow(0)).toBe('Hand Album')
      expect(await albumOfRow(1)).toBe('Album')
    })

    // Clearing a selection is the multi-track twin of the single clear: what it empties
    // is no longer the user's typing to protect, so the mark goes with the tags.
    it('drops the mark from every track a selection clear empties', async () => {
      handApi()
      const saveLastSession = vi.fn().mockResolvedValue(undefined)
      ;(window.api as unknown as { saveLastSession: unknown }).saveLastSession = saveLastSession
      const lastEdits = () =>
        Object.values(saveLastSession.mock.calls.at(-1)?.[1] ?? {}) as SessionEdit[]
      await renderApp()
      const rows = await addTwoTracks()
      fireEvent.click(rows[1], { metaKey: true })
      await typeAlbum('Hand Typed')
      await waitFor(() => expect(lastEdits().map((e) => e.handEdited)).toEqual([true, true]), {
        timeout: 3000,
      })

      fireEvent.click(await screen.findByTestId('clear-meta-btn'))

      await waitFor(
        () => {
          const edits = lastEdits()
          expect(edits.map((e) => e.meta.album)).toEqual(['', ''])
          expect(edits.map((e) => e.handEdited)).toEqual([undefined, undefined])
        },
        { timeout: 3000 },
      )
    })

    // A note in the comment is not a retag: no release writes the comment, so the sweep
    // still has the rest of the track's tags to fill.
    it('still matches a track whose only change is its comment', async () => {
      handApi()
      await renderApp()
      await addTwoTracks()
      await typeField('comment', 'warm up')

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
      expect(await fieldOfRow(0, 'comment')).toBe('warm up')
    })

    // A star is the DJ's judgement of the track, which no release writes: rating a crate
    // before matching it must not keep the sweep away from every rated track.
    it('still matches a track whose only change is its rating', async () => {
      handApi()
      await renderApp()
      await addTwoTracks()
      fireEvent.click(screen.getByTestId('star-4'))

      fireEvent.click(screen.getByTestId('auto-match'))
      await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    })
  })

  // With two tracks selected, a field typed in the editor writes to both. While the
  // user is still in the form, a probe that read the tracks after that write must not
  // land on either one, or the second track gets Discogs's album over the one the user
  // just typed while the first keeps theirs and the selection quietly splits.
  it('leaves every selected track alone while a bulk field is under edit', async () => {
    let releaseGate: () => void = () => {}
    const gate = new Promise<void>((res) => {
      releaseGate = res
    })
    const getRelease = vi.fn(async () => {
      await gate
      return release
    })
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ discogsToken: 'tok', visibleFields: ['title', 'artist', 'album'] }),
        ),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1], { metaKey: true })

    const album = await screen.findByTestId('field-album')
    fireEvent.focus(album)
    fireEvent.change(album, { target: { value: 'Hand Typed' } })

    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(getRelease).toHaveBeenCalledTimes(2))
    releaseGate()
    await waitFor(() => expect(screen.queryByTestId('sweep-icon-match')).toBeNull())

    expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0)
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(screen.getByTestId('field-album')).toHaveValue('Hand Typed'))
  })
})

beforeAll(installDragEvent)
afterEach(clearDraggedRows)

// The draggable wrapper of the row at this position in the list.
const rowWrapper = (index: number): HTMLElement => screen.getAllByTestId(/^track-drag-/)[index]

describe('App USB export', () => {
  // The export's state lives outside React for the whole renderer; a run one test ends must
  // not leak into the next.
  afterEach(() => usbExportStore.dispatch({ type: 'reset' }))
  function usbApi() {
    const feed: {
      volumes?: (l: UsbVolumeList) => void
      event?: (e: UsbExportEvent) => void
    } = {}
    setApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
        },
      }),
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'surco')], lastKey: null }),
      onUsbVolumesChanged: (cb: (l: UsbVolumeList) => void) => {
        feed.volumes = cb
        return () => {}
      },
      onUsbEvent: (cb: (e: UsbExportEvent) => void) => {
        feed.event = cb
        return () => {}
      },
      usbPlan: vi.fn<Api['usbPlan']>().mockResolvedValue({ ok: false, reason: 'nothing-selected' }),
    })
    return feed
  }

  // A stick plugged in with an export on it is what the DJ wants to refresh before a gig:
  // the notice opens the chooser on that very stick. Sticks already in at launch and empty
  // ones get no notice.
  it('offers to export to a stick holding an export when it is plugged in', async () => {
    const feed = usbApi()
    await renderApp()
    await waitFor(() => expect(window.api.usbVolumes).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('usb-connected')).not.toBeInTheDocument()
    act(() =>
      feed.volumes?.({
        volumes: [stick('A', 'surco'), stick('B', 'rekordbox'), stick('C', 'empty')],
        lastKey: null,
      }),
    )
    expect(screen.getAllByTestId('usb-connected')).toHaveLength(1)
    expect(screen.getByTestId('usb-connected')).toHaveTextContent('Stick B')
    fireEvent.click(screen.getByTestId('usb-connected-action'))
    expect(await screen.findByTestId('usb-export-modal')).toBeInTheDocument()
    expect(screen.getByTestId('usb-volume-pick-B')).toBeChecked()
  })

  // Closed, the modal is not there to say how the export ended, so a notice does; a stick
  // whose sync files failed must say rekordbox may not see its playlists.
  it('says how a background export ended', async () => {
    const feed = usbApi()
    await renderApp()
    await waitFor(() => expect(feed.event).toBeDefined())
    act(() => {
      feed.event?.({ type: 'started', tracks: [], targetName: 'Stick A', startedAt: 0 })
      feed.event?.({
        type: 'finished',
        outcome: 'done',
        tracks: 12,
        failed: 0,
        ms: 64000,
        syncFiles: false,
      })
    })
    expect(screen.getByTestId('usb-done-notice')).toHaveTextContent('12 tracks')
    expect(screen.getByTestId('usb-sync-files-notice')).toHaveTextContent(
      'rekordbox may not recognise its playlists',
    )
  })

  // The toolbar is memoized so App's renders do not reach it; a pill slot built fresh on
  // every App render would undo that. A stick list arriving re-renders App and changes
  // nothing the pill shows.
  it('hands the toolbar the same USB pill across App renders', async () => {
    const feed = usbApi()
    await renderApp()
    await waitFor(() => expect(feed.volumes).toBeDefined())
    await act(async () => {})
    const before = toolbarProps.last?.usbPill
    act(() => feed.volumes?.({ volumes: [stick('A', 'surco')], lastKey: null }))
    expect(toolbarProps.last?.usbPill).toBe(before)
  })

  // Escape closes the chooser like any other dialog, and the list's shortcuts stay off
  // while it is open.
  it('opens from the rekordbox tree and closes with Escape', async () => {
    usbApi()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    expect(await screen.findByTestId('usb-export-modal')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('usb-export-modal')).not.toBeInTheDocument())
  })

  it('opens from the rekordbox tree for a rekordbox export when Engine DJ is there too', async () => {
    const usbPlan = vi
      .fn<Api['usbPlan']>()
      .mockResolvedValue({ ok: false, reason: 'nothing-selected' })
    setApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
        },
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 2 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
        },
      }),
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }),
      usbPlan,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    expect(await screen.findByTestId('usb-export-modal')).toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('check-node-f'))
    await waitFor(() =>
      expect(usbPlan).toHaveBeenCalledWith({
        playlistIds: ['f'],
        target: { kind: 'volume', uuid: 'A' },
        prune: false,
        settings: false,
      }),
    )
    expect(screen.queryByTestId('check-node-7')).not.toBeInTheDocument()
  })

  it('opens from the Engine DJ tree on its playlists and asks for an Engine DJ export, even with no rekordbox', async () => {
    const usbPlan = vi
      .fn<Api['usbPlan']>()
      .mockResolvedValue({ ok: false, reason: 'nothing-selected' })
    setApi({
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 2 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
        },
      }),
      usbVolumes: vi
        .fn<Api['usbVolumes']>()
        .mockResolvedValue({ volumes: [stick('A', 'empty')], lastKey: null }),
      usbPlan,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-tree-export-usb'))
    expect(await screen.findByTestId('usb-export-modal')).toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('check-node-7'))
    await waitFor(() =>
      expect(usbPlan).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistIds: ['7'],
          target: { kind: 'volume', uuid: 'A' },
          source: 'engine',
        }),
      ),
    )
  })
})

describe('App source rail', () => {
  it('offers Engine DJ only on a machine with its library, as rekordbox only with a collection', async () => {
    await renderApp()
    await waitFor(() => expect(window.api.dj.available).toHaveBeenCalledWith('engine'))
    await act(async () => {})
    expect(screen.queryByTestId('source-rail-engine')).not.toBeInTheDocument()
    cleanup()
    setApi({
      dj: djReads({
        engine: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    expect(await screen.findByTestId('source-rail-engine')).toBeInTheDocument()
    expect(screen.queryByTestId('source-rail-rekordbox')).not.toBeInTheDocument()
  })

  // The rekordbox check is asynchronous: the window paints before it answers, and the
  // rail has to show up the moment the collection is found rather than never.
  it('appears once the rekordbox collection turns out to exist', async () => {
    let answer: (found: boolean) => void = () => {}
    setApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>(
            () => new Promise((resolve) => (answer = resolve)),
          ),
        },
      }),
    })
    await renderApp()
    await waitFor(() => expect(window.api.dj.available).toHaveBeenCalledWith('rekordbox'))
    expect(screen.queryByTestId('source-rail-rekordbox')).not.toBeInTheDocument()
    await act(async () => answer(true))
    expect(await screen.findByTestId('source-rail-rekordbox')).toBeInTheDocument()
  })

  it('the rail and Copias show even without any DJ program', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ hiddenSources: ['rekordbox', 'engine'] })),
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    await waitFor(() => expect(window.api.dj.available).toHaveBeenCalledWith('rekordbox'))
    await act(async () => {})
    expect(screen.getByTestId('source-rail')).toBeInTheDocument()
    expect(screen.queryByTestId('source-rail-rekordbox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-rail-copies'))
    expect(await screen.findByTestId('copies-screen')).toBeInTheDocument()
    expect(screen.getByTestId('copies-section-music')).toBeInTheDocument()
    expect(screen.queryByTestId('add-files')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(screen.queryByTestId('copies-screen')).not.toBeInTheDocument()
    expect(screen.getByTestId('add-files')).toBeInTheDocument()
  })

  it('hides a source from its right-click menu and keeps the choice in the settings', async () => {
    const base = settings()
    const saveSettings = vi.fn((patch: Partial<Settings>) => Promise.resolve({ ...base, ...patch }))
    setApi({
      saveSettings,
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    fireEvent.contextMenu(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(screen.getByTestId('source-rail-hide'))
    expect(saveSettings.mock.calls.at(-1)?.[0]).toEqual({ hiddenSources: ['rekordbox'] })
    await waitFor(() =>
      expect(screen.queryByTestId('source-rail-rekordbox')).not.toBeInTheDocument(),
    )
  })

  // A tree with nothing picked in it has no rows to show either: beside it stays the one
  // empty screen, not an empty list column. Picking a playlist is asking for its rows, so
  // the column is back before they have even loaded.
  it('keeps the tree beside the single empty screen until a playlist is picked', async () => {
    setApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
          playlist: vi.fn<ProgramReads['playlist']>(() => new Promise(() => {})),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-f')
    expect(screen.getByTestId('empty-dropzone')).toBeInTheDocument()
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-node-f'))
    expect(await screen.findByTestId('sidebar')).toBeInTheDocument()
  })

  // Music with nothing picked is not the working list: a Tracks row left on screen there
  // (and its editor beside it) read as that track being in Music. Nothing is lost by
  // leaving, so Tracks comes back with the row the user had open.
  it('shows none of the working list in Music until a playlist is picked, and gives Tracks back its selection', async () => {
    setApi({
      platform: 'darwin',
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Warm up', count: 1 }]),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    expect(await screen.findByTestId('field-title')).toBeInTheDocument()

    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    await screen.findByTestId('source-node-p1')
    expect(screen.queryAllByTestId('track-row')).toHaveLength(0)
    expect(screen.queryByTestId('field-title')).not.toBeInTheDocument()
    expect(screen.getByTestId('source-pick-playlist')).toHaveTextContent(
      'Pick a playlist to see its tracks',
    )
    runMenu('remove-all')
    await act(async () => {})
    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
  })

  // Row 120 of 310 kept selected but left off screen read as the selection being lost: the
  // list came back at its top, the place the user was working in nowhere to be seen.
  it('brings the row kept selected in Tracks back into view on return', async () => {
    setApi({
      platform: 'darwin',
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Warm up', count: 1 }]),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    await screen.findByTestId('source-node-p1')

    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const top = this.getAttribute('aria-selected') === 'true' ? 2400 : 0
        return { top, bottom: top + 24, height: 24 } as DOMRect
      })
    const scrolledTo = vi.fn()
    HTMLElement.prototype.scrollTo = scrolledTo
    try {
      fireEvent.click(screen.getByTestId('source-rail-tracks'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      await waitFor(() =>
        expect(scrolledTo).toHaveBeenCalledWith(
          expect.objectContaining({ top: expect.any(Number) }),
        ),
      )
      expect(scrolledTo.mock.contexts.at(-1)).toBe(screen.getByTestId('track-list-scroll'))
    } finally {
      rect.mockRestore()
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
    }
  })

  // Going back and forth between the working list and a set is the DJ's everyday move:
  // each side has to be where it was left, playlist and selected row included.
  it('gives each source back its own open playlist and selected row', async () => {
    const entry = (path: string) => ({ path, separator: false, meta: {} })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: { '/m/a.wav': 'Alpha', '/m/b.wav': 'Bravo', '/m/c.wav': 'Charlie' }[path],
        artist: 'DJ',
      })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 2 }]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([entry('/m/c.wav'), entry('/m/b.wav')]),
        },
      }),
    })
    await renderApp()
    const titles = () => screen.getAllByTestId('track-row').map((r) => r.textContent)
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])

    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() =>
      expect(titles()).toEqual([
        expect.stringContaining('Charlie'),
        expect.stringContaining('Bravo'),
      ]),
    )
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const selectedTitles = () =>
      screen
        .getAllByTestId('track-row')
        .filter((r) => r.getAttribute('aria-selected') === 'true')
        .map((r) => r.textContent)
    expect(selectedTitles()).toEqual([expect.stringContaining('Alpha')])
    expect(screen.getByTestId('field-title')).toHaveValue('Alpha')

    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    await waitFor(() =>
      expect(titles()).toEqual([
        expect.stringContaining('Charlie'),
        expect.stringContaining('Bravo'),
      ]),
    )
    expect(screen.getByTestId('source-node-f')).toHaveAttribute('aria-current', 'true')
    expect(selectedTitles()).toEqual([expect.stringContaining('Bravo')])
    expect(screen.getByTestId('field-title')).toHaveValue('Bravo')
  })

  function rekordboxWithFactory(over: Record<string, unknown> = {}): void {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
      ...over,
      dj: djReads(
        {
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
          },
        },
        over.dj as DjApi | undefined,
      ),
    })
  }

  // Files dropped while rekordbox is on screen land in the working list, which rekordbox
  // does not show: staying there read as the drop doing nothing.
  it('switches to Tracks when files are dropped while a source is on screen', async () => {
    rekordboxWithFactory({ getPathForFile: vi.fn(() => '/m/a.wav') })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-f')

    fireEvent.drop(screen.getByTestId('empty-dropzone'), {
      dataTransfer: fakeDataTransfer([new File([''], 'a.wav')]),
    })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByTestId('source-tree')).not.toBeInTheDocument()
  })

  // Same for the file picker: what was picked goes to Tracks, so Tracks is where it shows.
  // A cancelled picker added nothing, so the user stays where they were.
  it('switches to Tracks after picking files while a source is on screen, not after a cancel', async () => {
    const pickFiles = vi
      .fn<Api['pickFiles']>()
      .mockResolvedValueOnce([])
      .mockResolvedValue(['/m/a.wav'])
    rekordboxWithFactory({ pickFiles })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-f')

    runMenu('add')
    await waitFor(() => expect(pickFiles).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'true')

    runMenu('add')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
  })

  // Tracks comes forward with what was added, and what was added is what the next edit is
  // for, as when adding from Tracks itself: the row picked there before leaving came back
  // as the selection instead, and the new files had to be picked by hand.
  it('selects the files added while a source is on screen, not the row picked in Tracks before', async () => {
    rekordboxWithFactory({
      pickFiles: vi
        .fn<Api['pickFiles']>()
        .mockResolvedValueOnce(['/m/a.wav'])
        .mockResolvedValueOnce(['/m/b.wav', '/m/c.wav']),
    })
    await renderApp()
    runMenu('add')
    await screen.findByTestId('field-title')
    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-f')

    runMenu('add')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
  })

  it('selects the files added under a filter only the source offers, since Tracks drops it and hides nothing', async () => {
    rekordboxWithFactory({
      pickFiles: vi
        .fn<Api['pickFiles']>()
        .mockResolvedValueOnce(['/m/a.wav'])
        .mockResolvedValueOnce(['/m/b.wav', '/m/c.wav']),
      dj: djReads({
        rekordbox: {
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    runMenu('add')
    await screen.findByTestId('field-title')
    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
    fireEvent.click(screen.getByTestId('quality-filter-unanalysedRekordbox'))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    runMenu('add')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true')
    expect(await screen.findByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
  })

  // The list's count is the size of the list on screen: inside a playlist that is its rows,
  // not every track the working list has gathered.
  it('counts the open playlist’s rows in the list header, not the whole working list', async () => {
    rekordboxWithFactory({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav']),
      dj: djReads({
        rekordbox: {
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    expect(screen.getByTestId('track-position')).toHaveTextContent('‒/1')
    expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent(/^All$/)
  })

  // A playlist still being read is not an empty result: "No tracks match" there read as
  // the playlist having nothing in it.
  it('says the playlist is loading while its entries are read', async () => {
    rekordboxWithFactory({
      dj: djReads({
        rekordbox: { playlist: vi.fn<ProgramReads['playlist']>(() => new Promise(() => {})) },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))

    expect(await screen.findByTestId('source-playlist-loading')).toHaveTextContent(
      'Reading the playlist…',
    )
    expect(screen.queryByText('No tracks match.')).not.toBeInTheDocument()
  })

  it('draws placeholder rows in the shape of the tracks to come while the playlist is read', async () => {
    rekordboxWithFactory({
      dj: djReads({
        rekordbox: { playlist: vi.fn<ProgramReads['playlist']>(() => new Promise(() => {})) },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))

    const loading = await screen.findByTestId('source-playlist-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(within(loading).getAllByTestId('track-row-skeleton')).toHaveLength(8)
    expect(within(loading).queryByTestId('track-row')).toBeNull()
  })

  it('lists a rekordbox row rekordbox has art for from the light read and completes it once the row is selected', async () => {
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue({
      tags: { ...emptyMetadata(), title: 'Charlie' },
      duration: 200,
      cover: null,
      foreignTags: [{ name: 'ENERGY', value: '7' }],
    })
    rekordboxWithFactory({
      readMeta,
      readMetaLight: vi.fn<Api['readMetaLight']>().mockResolvedValue({
        tags: { ...emptyMetadata(), title: 'Charlie' },
        duration: 200,
        cover: null,
        foreignTags: [],
        partial: true,
      }),
      dj: djReads({
        rekordbox: {
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
            {
              path: '/m/c.wav',
              separator: false,
              meta: {},
              contentId: 'c',
              preview: {
                title: 'Charlie',
                artist: 'DJ',
                durationSec: 200,
                cues: [],
                coverUrl: 'surco://media/rekordbox-art.jpg',
              },
            },
          ]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')[0]).toHaveTextContent('Charlie'))
    await act(async () => {})
    expect(readMeta).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByTestId('track-row')[0])

    await waitFor(() => expect(readMeta).toHaveBeenCalledWith('/m/c.wav'))
  })

  // A read that failed is not an empty playlist either: it says why, as the tree does.
  it('says the playlist could not be read when reading its entries fails', async () => {
    rekordboxWithFactory({
      dj: djReads({
        rekordbox: {
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockRejectedValue(new Error('database is locked')),
        },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))

    expect(await screen.findByTestId('source-playlist-failed')).toHaveTextContent(
      "Couldn't read the collection.",
    )
    expect(screen.queryByText('No tracks match.')).not.toBeInTheDocument()
  })
})

describe('App source playlists', () => {
  // Browsing a rekordbox playlist must show the set as the DJ built it: only its tracks, in
  // its order, with its breaks drawn, loading the ones not in the list yet. Going back to
  // Tracks must give back the working list as it was: the playlist's new files stay in the
  // playlist, and opening it never drops a track of Tracks.
  it('shows a rekordbox playlist in the list, in its order, with the break drawn', async () => {
    const entry = (path: string | null, separator = false) => ({ path, separator, meta: {} })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/b.wav', '/m/x.wav', '/m/a.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: {
          '/m/a.wav': 'Alpha',
          '/m/b.wav': 'Bravo',
          '/m/c.wav': 'Charlie',
          '/m/x.wav': 'Xray',
        }[path],
        artist: 'DJ',
      })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 3 }]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([
              entry('/m/a.wav'),
              entry('/m/_.mp3', true),
              entry('/m/b.wav'),
              entry('/m/c.wav'),
            ]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))

    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row').map((r) => r.textContent)).toEqual([
        expect.stringContaining('Alpha'),
        expect.stringContaining('Bravo'),
        expect.stringContaining('Charlie'),
      ]),
    )
    const [rowA, rowB] = screen.getAllByTestId('track-row')
    const separator = await screen.findByTestId(/^track-separator-/)
    expect(rowA.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(separator.compareDocumentPosition(rowB) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(screen.queryByTestId('source-tree')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row').map((r) => r.textContent)).toEqual([
        expect.stringContaining('Bravo'),
        expect.stringContaining('Xray'),
        expect.stringContaining('Alpha'),
      ]),
    )
    expect(screen.queryByTestId(/^track-separator-/)).not.toBeInTheDocument()
  })

  // "si abro un playlist en Apple Music, luego voy a Files, aparecen también allí": a Music
  // playlist is browsed, not imported, so Tracks keeps only what the user put there.
  it('keeps an Apple Music playlist’s rows out of Tracks', async () => {
    setApi({
      platform: 'darwin',
      pickFiles: vi.fn<Api['pickFiles']>().mockResolvedValue(['/m/a.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: path === '/m/a.wav' ? 'Alpha' : 'Bravo',
        artist: 'DJ',
      })),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: 1 }]),
      loadAppleMusicPlaylistTracks: vi.fn<Api['loadAppleMusicPlaylistTracks']>().mockResolvedValue({
        paths: ['/m/b.wav'],
        persistentIds: {},
        meta: {},
        missing: 0,
      }),
    })
    await renderApp()
    await addOneTrack()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row').map((r) => r.textContent)).toEqual([
        expect.stringContaining('Bravo'),
      ]),
    )

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await act(async () => {})
    expect(screen.getAllByTestId('track-row').map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alpha'),
    ])
  })

  function openMusicPlaylist(paths: string[]): void {
    setApi({
      platform: 'darwin',
      readTags: vi.fn().mockResolvedValue({ title: 'Bravo', artist: 'DJ' }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: paths.length }]),
      loadAppleMusicPlaylistTracks: vi
        .fn<Api['loadAppleMusicPlaylistTracks']>()
        .mockResolvedValue({ paths, persistentIds: {}, meta: {}, missing: 0 }),
    })
  }

  // Files chosen or dropped from a library view land in Tracks, not in the playlist on
  // screen, so the panel beside a library playlist must not offer them; it says what to do
  // there instead.
  it('asks for a track, not for files, beside a library playlist with none open', async () => {
    openMusicPlaylist(['/m/b.wav'])
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    await screen.findByTestId('track-row')
    expect(within(screen.getByRole('main')).queryByTestId('add-files')).toBeNull()
    expect(screen.getByTestId('source-pick-track')).toHaveTextContent(i18n.t('sources.pickTrack'))
    fireEvent.click(screen.getByTestId('source-pick-track'))
    await act(async () => {})
    expect(window.api.pickFiles).not.toHaveBeenCalled()
  })

  it('says the library playlist is empty instead of asking for a track it does not have', async () => {
    openMusicPlaylist([])
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    expect(await screen.findByTestId('source-empty-playlist')).toHaveTextContent(
      i18n.t('sources.emptyPlaylist'),
    )
    expect(screen.queryByTestId('source-pick-track')).toBeNull()
    expect(within(screen.getByRole('main')).queryByTestId('add-files')).toBeNull()
  })

  describe('an Apple Music playlist’s covers', () => {
    const cover = { thumbUrl: 'thumb://own', width: 600, height: 600 }
    function musicPlaylist(appleMusicArtwork: Api['appleMusicArtwork']): void {
      setApi({
        platform: 'darwin',
        readMeta: vi.fn(async (path: string) => ({
          tags: { title: path === '/m/a.wav' ? 'Alpha' : 'Bravo', artist: 'DJ' },
          duration: 180,
          cover: path === '/m/a.wav' ? cover : null,
        })),
        loadAppleMusicPlaylists: vi
          .fn<Api['loadAppleMusicPlaylists']>()
          .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: 2 }]),
        loadAppleMusicPlaylistTracks: vi
          .fn<Api['loadAppleMusicPlaylistTracks']>()
          .mockResolvedValue({
            paths: ['/m/a.wav', '/m/b.wav'],
            persistentIds: { '/m/a.wav': 'PA', '/m/b.wav': 'PB' },
            meta: {},
            missing: 0,
          }),
        appleMusicArtwork: vi.fn(appleMusicArtwork),
      })
    }
    async function openFriday(): Promise<void> {
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
      fireEvent.click(await screen.findByTestId('source-node-p1'))
    }

    it('shows the rows while Music is still busy with the covers', async () => {
      musicPlaylist(() => new Promise(() => {}))
      await openFriday()
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    })

    it('fills the cover a file lacks from Music, and asks only for that one', async () => {
      musicPlaylist(async () => ({ PB: { coverPath: '/art/PB.jpg', coverUrl: 'thumb://pb' } }))
      await openFriday()
      await waitFor(() =>
        expect(screen.getAllByTestId('track-cover').map((c) => c.getAttribute('src'))).toEqual([
          'thumb://own',
          'thumb://pb',
        ]),
      )
      expect(window.api.appleMusicArtwork).toHaveBeenCalledTimes(1)
      expect(window.api.appleMusicArtwork).toHaveBeenCalledWith(['PB'])
    })
  })

  function factoryWithAlpha(over: Record<string, unknown> = {}): void {
    setApi({
      readTags: vi.fn(async (path: string) => ({
        title: path === '/m/a.wav' ? 'Alpha' : 'Bravo',
        artist: 'DJ',
      })),
      ...over,
      dj: djReads(
        {
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
          },
        },
        over.dj as DjApi | undefined,
      ),
    })
  }

  // The same file dropped in Tracks after its playlist loaded it is one track in both
  // places, with the edits it has; it was not in Tracks, so it is no duplicate either.
  it('puts a dropped file that the open playlist holds in Tracks as one row, with no duplicate notice', async () => {
    factoryWithAlpha({ getPathForFile: vi.fn(() => '/m/a.wav') })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await act(async () => {})
    expect(screen.queryAllByTestId('track-row')).toHaveLength(0)

    fireEvent.drop(screen.getByTestId('empty-dropzone'), {
      dataTransfer: fakeDataTransfer([new File([''], 'a.wav')]),
    })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-row')).toHaveTextContent('Alpha')
    await act(async () => {})
    expect(screen.queryByTestId('app-notice')).not.toBeInTheDocument()
  })

  it('offers to add files in an empty Tracks after a playlist was browsed, since there is no track there to pick', async () => {
    factoryWithAlpha()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await act(async () => {})

    expect(screen.queryAllByTestId('track-row')).toHaveLength(0)
    expect(screen.queryByTestId('source-pick-track')).toBeNull()
    expect(within(screen.getByRole('main')).getByTestId('add-files')).toBeInTheDocument()
  })

  it('points at Tracks, not at the open playlist, while files are dragged over a DJ library, because Tracks is where a drop puts them', async () => {
    factoryWithAlpha()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    const root = screen.getByTestId('app-root')

    fireEvent.dragEnter(root)

    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('data-drop-over', 'true'),
    )
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over')
    expect(screen.getByTestId('empty-dropzone')).not.toHaveAttribute('data-drop-over')

    fireEvent.dragLeave(root)

    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).not.toHaveAttribute('data-drop-over'),
    )
  })

  it('leaves the Tracks button alone while files are dragged over Tracks itself, where the list column already answers', async () => {
    setApi({ pickFiles: vi.fn<Api['pickFiles']>().mockResolvedValue(['/m/a.wav']) })
    await renderApp()
    await addOneTrack()

    fireEvent.dragEnter(screen.getByTestId('app-root'))

    await waitFor(() =>
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drop-over', 'true'),
    )
    expect(screen.getByTestId('source-rail-tracks')).not.toHaveAttribute('data-drop-over')
  })

  // Removing from Tracks is about Tracks: the playlist still lists the file, so its row
  // stays there with what the user typed on it.
  // "pedimos restaurar las de files": browsing a playlist at launch is not starting a new
  // Tracks list, so the offer to bring the last one back stays until it is answered.
  it('still offers the last Tracks list after a playlist is opened, and restores it', async () => {
    factoryWithAlpha({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/m/b.wav'], edits: {} }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await act(async () => {})
    expect(screen.getByTestId('last-session')).not.toHaveAttribute('aria-hidden')

    fireEvent.click(screen.getByTestId('last-session-action'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row').map((r) => r.textContent)).toEqual([
        expect.stringContaining('Bravo'),
      ]),
    )
  })

  it('keeps a row removed from Tracks, edits included, in the open playlist that lists it', async () => {
    const pickFiles = vi.fn<Api['pickFiles']>().mockResolvedValue(['/m/a.wav'])
    factoryWithAlpha({ pickFiles })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('add')
    await waitFor(() => expect(pickFiles).toHaveBeenCalled())
    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('track-row'))
    fireEvent.change(await screen.findByTestId('field-title'), {
      target: { value: 'Hand Typed' },
    })
    fireEvent.blur(screen.getByTestId('field-title'))

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('track-row'))
    expect(await screen.findByTestId('field-title')).toHaveValue('Hand Typed')
  })

  // A row a playlist still lists is only taken out of Tracks, never out of the collection.
  // Undo has to put it back in Tracks too, or the DJ would find it only in the playlist.
  it('puts a row its playlist kept back in Tracks, edits included, when the removal is undone', async () => {
    const pickFiles = vi.fn<Api['pickFiles']>().mockResolvedValue(['/m/a.wav'])
    factoryWithAlpha({ pickFiles })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('add')
    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true'),
    )
    fireEvent.click(screen.getByTestId('track-row'))
    fireEvent.change(await screen.findByTestId('field-title'), {
      target: { value: 'Hand Typed' },
    })
    fireEvent.blur(screen.getByTestId('field-title'))

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    fireEvent.click(await screen.findByTestId('app-notice-action'))

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('track-row'))
    expect(await screen.findByTestId('field-title')).toHaveValue('Hand Typed')
  })

  // The Undo of a removal holds the row while it is on offer. Once that file goes to the
  // Trash from the playlist, Undo would bring back a row whose file is gone.
  it('does not bring back a row whose file was trashed while its removal could be undone', async () => {
    const pickFiles = vi.fn<Api['pickFiles']>().mockResolvedValue(['/m/a.wav'])
    const trashFile = vi.fn<Api['trashFile']>().mockResolvedValue({ where: 'trash' })
    factoryWithAlpha({ pickFiles, trashFile })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('add')
    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true'),
    )
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(trashFile).toHaveBeenCalledWith('/m/a.wav', false))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    const removal = screen
      .getAllByTestId('app-notice')
      .find((card) => card.textContent?.includes('removed from the list'))
    if (!removal) throw new Error('no removal toast')
    fireEvent.click(within(removal).getByTestId('app-notice-action'))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await act(async () => {})
    expect(screen.queryAllByTestId('track-row')).toHaveLength(0)
  })

  // A file rekordbox still lists but the disk no longer has is a row that silently vanishes
  // from the playlist; the notice is what tells the user the gap is not Surco losing it.
  it('counts a playlist file that is gone from disk in the missing-file notice', async () => {
    const entry = (path: string | null) => ({ path, separator: false, meta: {} })
    setApi({
      readTags: vi.fn(async () => ({ title: 'Alpha', artist: 'DJ' })),
      expandPaths: vi.fn(async (paths: string[]) => paths.filter((p) => p !== '/m/gone.wav')),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 2 }]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([entry('/m/a.wav'), entry('/m/gone.wav')]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      '1 track from “Factory” has no file on disk',
    )
  })

  it('counts the tracks without a file of every stretch of a long Music playlist, not only the first', async () => {
    const stretch = (paths: string[], missing: number) => ({
      paths,
      persistentIds: {},
      meta: {},
      missing,
      total: 400,
    })
    setApi({
      platform: 'darwin',
      readTags: vi.fn(async () => ({ title: 'Alpha', artist: 'DJ' })),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: 400 }]),
      loadAppleMusicPlaylistTracks: vi.fn<Api['loadAppleMusicPlaylistTracks']>(
        async (_id, from) => {
          if (from === 1) return stretch(['/m/a.wav'], 1)
          await new Promise((r) => setTimeout(r, 300))
          return stretch(['/m/b.wav'], 1)
        },
      ),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    expect(await screen.findByTestId('app-notice')).toHaveTextContent('2 tracks from “Friday”')
  })

  it('says which playlist went away when rekordbox deleted it while it was open', async () => {
    const focusListeners: ((focused: boolean) => void)[] = []
    setApi({
      onWindowFocus: (cb: (focused: boolean) => void) => {
        focusListeners.push(cb)
        return () => {}
      },
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValueOnce([{ id: 'f', name: 'Factory', kind: 'playlist', count: 0 }])
            .mockResolvedValue([]),
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    act(() => {
      for (const cb of focusListeners) cb(true)
    })
    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      '“Factory” is no longer in rekordbox',
    )
  })

  // Each library has its own folders and names: a search typed for Music would filter
  // rekordbox's tree down to nothing the user asked for there.
  it('starts the rekordbox tree fresh after browsing Music', async () => {
    setApi({
      platform: 'darwin',
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 0 }]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.change(await screen.findByTestId('source-tree-search'), {
      target: { value: 'house' },
    })
    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    expect(await screen.findByTestId('source-node-f')).toBeInTheDocument()
    expect(screen.getByTestId('source-tree-search')).toHaveValue('')
  })

  // The format filter is the user's choice for the working list; a playlist without that
  // format (or one whose rows are still loading) must not throw it away for Tracks too.
  it('keeps the format filter for the working list after opening a playlist without that format', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() =>
      expect(window.api.dj.playlist).toHaveBeenCalledWith('rekordbox', expect.anything()),
    )
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
  })

  // A collection repeats the same set across folders ("Todas", "Top") in another order.
  // Keeping the selected track's list still while it is edited must not keep the previous
  // playlist's order once another playlist is opened, or its breaks land between the wrong rows.
  it('shows the next playlist in its own order even while a track stays selected', async () => {
    const entry = (path: string | null, separator = false) => ({ path, separator, meta: {} })
    const playlists: Record<string, ReturnType<typeof entry>[]> = {
      f: [entry('/m/a.wav'), entry('/m/_.mp3', true), entry('/m/b.wav'), entry('/m/c.wav')],
      g: [entry('/m/c.wav'), entry('/m/b.wav'), entry('/m/_.mp3', true), entry('/m/a.wav')],
    }
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: { '/m/a.wav': 'Alpha', '/m/b.wav': 'Bravo', '/m/c.wav': 'Charlie' }[path],
        artist: 'DJ',
      })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: 'f', name: 'Todas', kind: 'playlist', count: 3 },
            { id: 'g', name: 'Top', kind: 'playlist', count: 3 },
          ]),
          playlist: vi.fn<ProgramReads['playlist']>(async (id) => playlists[id]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    const titles = () => screen.getAllByTestId('track-row').map((r) => r.textContent)
    await waitFor(() => expect(screen.queryByTestId(/^track-separator-/)).toBeInTheDocument())
    fireEvent.click(screen.getAllByTestId('track-row')[0])

    fireEvent.click(screen.getByTestId('source-node-g'))
    await waitFor(() =>
      expect(titles()).toEqual([
        expect.stringContaining('Charlie'),
        expect.stringContaining('Bravo'),
        expect.stringContaining('Alpha'),
      ]),
    )
    const [, rowBravo, rowAlpha] = screen.getAllByTestId('track-row')
    const separator = screen.getByTestId(/^track-separator-/)
    expect(
      rowBravo.compareDocumentPosition(separator) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      separator.compareDocumentPosition(rowAlpha) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  // A picked playlist whose entries have not arrived is still that source's list, not the
  // working list: the toolbar sweeps have nothing in view to act on, so they stay disabled
  // instead of running over Tracks' rows from a rekordbox view.
  it('leaves the toolbar sweeps nothing to run on while a playlist loads', async () => {
    const pending = () => new Promise(() => {})
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
      search: vi.fn(pending),
      spectrogram: vi.fn(pending),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
          playlist: vi.fn<ProgramReads['playlist']>(() => new Promise(() => {})),
        },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() =>
      expect(window.api.dj.playlist).toHaveBeenCalledWith('rekordbox', expect.anything()),
    )

    expect(screen.queryAllByTestId('track-row')).toHaveLength(0)
    expect(screen.getByTestId('auto-match')).toBeDisabled()
    expect(screen.getByTestId('analyze-quality')).toBeDisabled()
  })

  // The analysis sweep starts the open playlist's tracks next, and the playlist left behind
  // still finishes after it.
  describe('background analysis', () => {
    const entry = (path: string) => ({ path, separator: false, meta: {} })
    const playlists: Record<string, ReturnType<typeof entry>[]> = {
      a: ['/m/a1.wav', '/m/a2.wav', '/m/a3.wav', '/m/a4.wav', '/m/a5.wav'].map(entry),
      b: [entry('/m/b1.wav')],
    }
    function setupPlaylists(): { analyzed: string[]; release: () => void } {
      const analyzed: string[] = []
      let release: () => void = () => {}
      const gate = new Promise<void>((r) => {
        release = r
      })
      setApi({
        getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
        readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
        spectrogram: vi.fn(async (path: string) => {
          analyzed.push(path)
          await gate
          return spectrum
        }),
        dj: djReads({
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
              { id: 'a', name: 'Warm up', kind: 'playlist', count: 5 },
              { id: 'b', name: 'Peak', kind: 'playlist', count: 1 },
            ]),
            playlist: vi.fn<ProgramReads['playlist']>(async (id) => playlists[id]),
          },
        }),
      })
      return { analyzed, release: () => release() }
    }

    // Opening a playlist is going to see what it holds: a search typed in the one before
    // made the new one look short or empty.
    it('clears the search when another playlist is opened', async () => {
      setupPlaylists()
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
      fireEvent.click(await screen.findByTestId('source-node-a'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(5))
      fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'zz' } })

      fireEvent.click(screen.getByTestId('source-node-b'))

      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      expect(screen.getByTestId('track-search')).toHaveValue('')
    })

    // Each source keeps the search left in it: coming back to rekordbox finds it where it was.
    it('gives a source its search back when coming back to it', async () => {
      setupPlaylists()
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
      fireEvent.click(await screen.findByTestId('source-node-a'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(5))
      fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'song' } })

      fireEvent.click(screen.getByTestId('source-rail-tracks'))
      fireEvent.click(screen.getByTestId('source-rail-rekordbox'))

      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(5))
      expect(screen.getByTestId('track-search')).toHaveValue('song')
    })

    async function leaveForPeak(): Promise<void> {
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
      fireEvent.click(await screen.findByTestId('source-node-a'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(5))
      fireEvent.click(screen.getByTestId('source-node-b'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      await waitFor(() =>
        expect(within(screen.getByTestId('track-row')).getByText('My Song')).toBeInTheDocument(),
      )
    }

    it('analyzes the open playlist before what is left of the one behind', async () => {
      const { analyzed, release } = setupPlaylists()
      await leaveForPeak()
      const startedInA = analyzed.length

      release()
      await waitFor(() => expect(analyzed).toContain('/m/b1.wav'), { timeout: 4000 })

      expect(analyzed.indexOf('/m/b1.wav')).toBe(startedInA)
    })

    // A DJ leaves the sweep running while browsing; the playlist left behind still finishes.
    it('finishes the playlist left behind without opening it again', async () => {
      const { analyzed, release } = setupPlaylists()
      await leaveForPeak()

      release()

      await waitFor(
        () => expect(analyzed).toEqual(expect.arrayContaining(playlists.a.map((e) => e.path))),
        { timeout: 4000 },
      )
      await waitFor(() => expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull())
    })
  })

  const linked = (path: string, linkId: string, separator = false) => ({
    path,
    separator,
    meta: {},
    linkId,
    contentId: `c-${linkId}`,
  })
  const FACTORY_ENTRIES = [
    linked('/m/a.wav', 'l1'),
    linked('/m/_.mp3', 's1', true),
    linked('/m/b.wav', 'l2'),
    linked('/m/c.wav', 'l3'),
  ]
  const TITLES: Record<string, string> = {
    '/m/a.wav': 'Alpha',
    '/m/b.wav': 'Bravo',
    '/m/c.wav': 'Charlie',
    '/m/d.wav': 'Delta',
  }
  const titles = () => screen.getAllByTestId('track-row').map((r) => r.textContent ?? '')
  const expectNoReorderLine = () => {
    const [row] = screen.getAllByTestId(/^track-drag-/)
    fireEvent.dragStart(row, { dataTransfer: fakeDataTransfer() })
    fireEvent.dragOver(row, { dataTransfer: fakeDataTransfer(), clientY: -1 })
    expect(screen.queryByTestId('reorder-line')).not.toBeInTheDocument()
  }
  const tryToReorder = () => {
    const dt = fakeDataTransfer()
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: dt })
    fireEvent.dragOver(rowWrapper(0), { dataTransfer: dt, clientY: 1 })
    fireEvent.drop(rowWrapper(0), { dataTransfer: dt })
  }

  async function openFactory(over: Record<string, unknown> = {}, loaded = 3) {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav']),
      readTags: vi.fn(async (path: string) => ({ title: TITLES[path], artist: 'DJ' })),
      startTrackDrag: vi.fn(),
      ...over,
      dj: djReads(
        {
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
              { id: 'f', name: 'Factory', kind: 'playlist', count: 3 },
              { id: 'h', name: 'House', kind: 'playlist', count: 0 },
            ]),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue(FACTORY_ENTRIES),
          },
        },
        over.dj as DjApi | undefined,
      ),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(loaded))
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await screen.findByTestId('track-separator-s1')
  }

  describe('Matching in the editor', () => {
    const withPreview = (path: string, contentId: string) => ({
      path,
      separator: false,
      meta: {},
      contentId,
      preview: { title: TITLES[path], artist: 'DJ', durationSec: 200, cues: [] },
    })
    const matchingReads = {
      dj: djReads({
        rekordbox: {
          matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['c-l1', 'c-l3']]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockImplementation(async (id) =>
              id === MATCHING_ID
                ? [withPreview('/m/a.wav', 'c-l1'), withPreview('/m/c.wav', 'c-l3')]
                : FACTORY_ENTRIES,
            ),
        },
      }),
    }
    const rowTitled = (title: string) =>
      screen.getAllByTestId('track-row').find((r) => r.textContent?.includes(title)) as HTMLElement

    it('shows the partners rekordbox holds for the chosen track', async () => {
      await openFactory(matchingReads)
      fireEvent.click(rowTitled('Alpha'))
      expect(await screen.findByTestId('matching-partner')).toHaveTextContent('Charlie')
    })

    it('marks the partners of the chosen track in the list with the Matching rings', async () => {
      await openFactory(matchingReads)
      fireEvent.click(rowTitled('Alpha'))
      await waitFor(() =>
        expect(within(rowTitled('Charlie')).getByTestId('track-matching')).toBeInTheDocument(),
      )
      expect(within(rowTitled('Bravo')).queryByTestId('track-matching')).not.toBeInTheDocument()
      expect(within(rowTitled('Alpha')).queryByTestId('track-matching')).not.toBeInTheDocument()
    })

    it('pairs two selected tracks from the row menu, asking about an open rekordbox first', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(rowTitled('Bravo'), { metaKey: true })
      fireEvent.contextMenu(rowTitled('Bravo'))
      fireEvent.click(await screen.findByTestId('track-menu-matching'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith(
          'add',
          ['c-l1', 'c-l2'],
          expect.stringContaining('Alpha'),
        ),
      )
      expect(vi.mocked(window.api.dj.askToApply).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(window.api.dj.match).mock.invocationCallOrder[0],
      )
    })

    it('matches three or more selected tracks as one block led by the first on screen, so a run picked in a playlist is matched in one go', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(rowTitled('Bravo'), { metaKey: true })
      fireEvent.click(rowTitled('Charlie'), { metaKey: true })
      fireEvent.contextMenu(rowTitled('Charlie'))
      const item = await screen.findByTestId('track-menu-matching')
      expect(item).toHaveTextContent('Make a Matching block')
      fireEvent.click(item)
      await waitFor(() => expect(match).toHaveBeenCalledTimes(2))
      expect(match).toHaveBeenNthCalledWith(1, 'add', ['c-l1', 'c-l2'], expect.any(String))
      expect(match).toHaveBeenNthCalledWith(2, 'add', ['c-l1', 'c-l3'], expect.any(String))
      expect(window.api.dj.askToApply).toHaveBeenCalledTimes(1)
    })

    it('keeps the pair in Surco by file too, so it holds in every program and after a conversion', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(rowTitled('Bravo'), { metaKey: true })
      fireEvent.contextMenu(rowTitled('Bravo'))
      fireEvent.click(await screen.findByTestId('track-menu-matching'))
      await waitFor(() =>
        expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav'),
      )
    })

    it('drops the pair from Surco too when the DJ unpairs it', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(await screen.findByTestId('matching-partner-remove'))
      await waitFor(() =>
        expect(window.api.removeMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/c.wav'),
      )
    })

    it('offers to unpair two selected tracks that are already a pair instead of pairing them again', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      await within(rowTitled('Charlie')).findByTestId('track-matching')
      fireEvent.click(rowTitled('Charlie'), { metaKey: true })
      fireEvent.contextMenu(rowTitled('Charlie'))
      const unmatch = await screen.findByTestId('track-menu-unmatch')
      expect(screen.queryByTestId('track-menu-matching')).not.toBeInTheDocument()
      fireEvent.click(unmatch)
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('remove', ['c-l1', 'c-l3'], expect.any(String)),
      )
    })

    it('unpairs the chosen track from the ringed row right-clicked alone, in rekordbox too', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      await within(rowTitled('Charlie')).findByTestId('track-matching')
      fireEvent.contextMenu(rowTitled('Charlie'))
      fireEvent.click(await screen.findByTestId('track-menu-unmatch'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('remove', ['c-l1', 'c-l3'], expect.any(String)),
      )
    })

    it('empties every block a track leads or follows in from Matching in one write, asking about an open rekordbox once', async () => {
      const matchAll = vi
        .fn<ProgramReads['matchAll']>()
        .mockImplementation(async (_action, pairs) => pairs.map(() => ({ applied: true })))
      await openFactory({
        dj: djReads(matchingReads.dj, {
          rekordbox: {
            matchAll,
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([
              ['c-l1', 'c-l3'],
              ['c-l3', 'c-l2'],
            ]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === MATCHING_ID
                  ? [
                      withPreview('/m/a.wav', 'c-l1'),
                      withPreview('/m/c.wav', 'c-l3'),
                      withPreview('/m/b.wav', 'c-l2'),
                    ]
                  : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
      fireEvent.contextMenu(rowTitled('Charlie'))
      const remove = await screen.findByTestId('track-menu-remove')
      expect(remove).toHaveTextContent('Matching')
      fireEvent.click(remove)
      await screen.findByTestId('confirm-ok')
      expect(document.getElementById('confirm-title')).toHaveTextContent('3')
      expect(matchAll).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('confirm-ok'))
      await waitFor(() => expect(matchAll).toHaveBeenCalledTimes(1))
      expect(matchAll).toHaveBeenCalledWith('remove', [
        { pair: ['c-l1', 'c-l3'], label: expect.any(String) },
        { pair: ['c-l3', 'c-l2'], label: expect.any(String) },
      ])
      expect(window.api.dj.askToApply).toHaveBeenCalledTimes(1)
      expect(window.api.removeMatchingPairs).toHaveBeenCalledWith([
        ['/m/a.wav', '/m/c.wav'],
        ['/m/c.wav', '/m/b.wav'],
      ])
    })

    it('still drops from Surco the pairs rekordbox unpaired when one of them was already gone from it', async () => {
      const matchAll = vi
        .fn<ProgramReads['matchAll']>()
        .mockResolvedValue([{ applied: false, reason: 'stale' }, { applied: true }])
      await openFactory({
        dj: djReads(matchingReads.dj, {
          rekordbox: {
            matchAll,
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([
              ['c-l1', 'c-l3'],
              ['c-l3', 'c-l2'],
            ]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === MATCHING_ID
                  ? [
                      withPreview('/m/a.wav', 'c-l1'),
                      withPreview('/m/c.wav', 'c-l3'),
                      withPreview('/m/b.wav', 'c-l2'),
                    ]
                  : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
      fireEvent.contextMenu(rowTitled('Charlie'))
      const remove = await screen.findByTestId('track-menu-remove')
      expect(remove).toHaveTextContent('Matching')
      fireEvent.click(remove)
      await screen.findByTestId('confirm-ok')
      expect(document.getElementById('confirm-title')).toHaveTextContent('3')
      fireEvent.click(screen.getByTestId('confirm-ok'))
      await waitFor(() =>
        expect(window.api.removeMatchingPairs).toHaveBeenCalledWith([['/m/c.wav', '/m/b.wav']]),
      )
    })

    it('drops the one-track items from the menu of a multi-selection, like copying a single path', async () => {
      await openFactory(matchingReads)
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(rowTitled('Bravo'), { metaKey: true })
      fireEvent.contextMenu(rowTitled('Bravo'))
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-copy')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-info')).not.toBeInTheDocument()
    })

    it('offers no unpairing on a track that is not a partner of the chosen one', async () => {
      await openFactory(matchingReads)
      fireEvent.click(rowTitled('Alpha'))
      await within(rowTitled('Charlie')).findByTestId('track-matching')
      fireEvent.contextMenu(rowTitled('Bravo'))
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-unmatch')).not.toBeInTheDocument()
    })

    it('offers no pairing unless exactly two tracks are selected', async () => {
      await openFactory(matchingReads)
      fireEvent.contextMenu(rowTitled('Bravo'))
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-matching')).not.toBeInTheDocument()
    })

    it('pairs the chosen track with one found in the rekordbox collection from the editor', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      const collection = vi.fn<ProgramReads['collection']>().mockResolvedValue([
        { contentId: 'c-l2', path: '/m/b.wav', title: 'Bravo', artist: 'DJ' },
        { contentId: 'x9', path: '/m/elsewhere.wav', title: 'Brave New World', artist: 'Someone' },
      ])
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match, collection } }) })
      fireEvent.click(rowTitled('Bravo'))
      fireEvent.change(await screen.findByTestId('matching-search'), {
        target: { value: 'brave new' },
      })
      fireEvent.click(await screen.findByTestId('matching-result'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith(
          'add',
          ['c-l2', 'x9'],
          expect.stringContaining('Brave New World'),
        ),
      )
      expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/b.wav', '/m/elsewhere.wav')
    })

    it('keeps Matching out of the editor for a track not opened from rekordbox', async () => {
      setApi({
        pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav']),
        readTags: vi.fn(async (path: string) => ({ title: TITLES[path], artist: 'DJ' })),
        dj: matchingReads.dj,
      })
      await renderApp()
      fireEvent.click(await screen.findByTestId('add-files'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
      fireEvent.click(rowTitled('Alpha'))
      await screen.findByTestId('editor-scroll')
      expect(screen.queryByTestId('matching-section')).not.toBeInTheDocument()
    })

    const playedReads = (extra: Partial<ProgramReads> = {}) =>
      djReads(matchingReads.dj, {
        rekordbox: {
          playedTogether: vi.fn<ProgramReads['playedTogether']>().mockResolvedValue([
            ['c-l1', 'c-l2'],
            ['c-l2', 'c-l1'],
            ['x', 'c-l1', 'c-l2'],
          ]),
          collection: vi.fn<ProgramReads['collection']>().mockResolvedValue([
            { contentId: 'c-l1', path: '/m/a.wav', title: 'Alpha', artist: 'DJ' },
            { contentId: 'c-l2', path: '/m/b.wav', title: 'Bravo', artist: 'DJ' },
            { contentId: 'c-l3', path: '/m/c.wav', title: 'Charlie', artist: 'DJ' },
          ]),
          ...extra,
        },
      })

    it('suggests in Matching the pairs played back to back three times and pairs one in a click', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: playedReads({ match }) })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      const card = await screen.findByTestId('matching-suggestion')
      expect(card).toHaveTextContent('Alpha')
      expect(card).toHaveTextContent('Bravo')
      fireEvent.click(screen.getByTestId('matching-suggestion-match'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('add', ['c-l1', 'c-l2'], expect.any(String)),
      )
      expect(window.api.addMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav')
    })

    it('hides the suggestions while searching, so the blocks found are the first thing in view', async () => {
      await openFactory({ dj: playedReads() })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await screen.findByTestId('matching-suggestion')
      fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'Alpha' } })
      await waitFor(() => expect(screen.queryByTestId('matching-suggestion')).toBeNull())
      fireEvent.change(screen.getByTestId('track-search'), { target: { value: '' } })
      expect(await screen.findByTestId('matching-suggestion')).toBeInTheDocument()
    })

    it('remembers a dismissed suggestion so it is not offered again', async () => {
      await openFactory({ dj: playedReads() })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      fireEvent.click(await screen.findByTestId('matching-suggestion-dismiss'))
      await waitFor(() =>
        expect(window.api.saveSettings).toHaveBeenCalledWith(
          expect.objectContaining({ matchingDismissed: ['c-l1|c-l2'] }),
        ),
      )
    })

    it('remembers the suggestions closed from the toolbar, so a DJ who hides them does it once', async () => {
      await openFactory({
        dj: playedReads(),
        saveSettings: vi.fn((patch) => Promise.resolve({ ...settings(), ...patch })),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await screen.findByTestId('matching-suggestion')
      fireEvent.click(
        within(screen.getByTestId('track-list-toolbar')).getByTestId('matching-suggestions-toggle'),
      )
      await waitFor(() =>
        expect(window.api.saveSettings).toHaveBeenCalledWith(
          expect.objectContaining({ matchingSuggestionsOpen: false }),
        ),
      )
      await waitFor(() =>
        expect(screen.getByTestId('matching-suggestions-toggle')).toHaveAttribute(
          'aria-pressed',
          'false',
        ),
      )
    })

    it('offers in the editor the tracks often played with the chosen one', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: playedReads({ match }) })
      fireEvent.click(rowTitled('Bravo'))
      const row = await screen.findByTestId('matching-suggested')
      expect(row).toHaveTextContent('Alpha')
      fireEvent.click(screen.getByTestId('matching-suggested-match'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('add', ['c-l2', 'c-l1'], expect.any(String)),
      )
    })

    it('unpairs a partner from the editor', async () => {
      const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
      await openFactory({ dj: djReads(matchingReads.dj, { rekordbox: { match } }) })
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(await screen.findByTestId('matching-partner-remove'))
      await waitFor(() =>
        expect(match).toHaveBeenCalledWith('remove', ['c-l1', 'c-l3'], expect.any(String)),
      )
    })

    it('moves to a partner in the open list when the DJ picks it', async () => {
      await openFactory(matchingReads)
      fireEvent.click(rowTitled('Alpha'))
      fireEvent.click(await screen.findByTestId('matching-partner'))
      await waitFor(() => expect(rowTitled('Charlie')).toHaveAttribute('aria-selected', 'true'))
      expect(rowTitled('Alpha')).toHaveAttribute('aria-selected', 'false')
    })
  })

  it('runs Auto marcar over the selected rows of the open playlist by their rekordbox entry', async () => {
    const read = vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null)
    await openFactory({ cues: { trackCues: read } })
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('cues-auto-mark-all'))
    await waitFor(() => expect(autoMarkOf('c-l2')).toEqual({ kind: 'unanalysed' }))
    expect(autoMarkOf('c-l1')).toEqual({ kind: 'unanalysed' })
    expect(autoMarkOf('c-l3')).toBeUndefined()
  })

  describe('phrase counts saved to rekordbox', () => {
    const grid = Array.from({ length: 800 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    const analysed = vi.fn<Api['cues']['trackCues']>(async (contentId) => ({
      contentId,
      analysed: true,
      grid,
      strong: [],
      phrases: [],
      cues: [0, 64, 320].map((b) => ({ id: `c${b}`, ms: b * 500, kind: 0, color: null })),
      wave: null,
      durationMs: 400000,
      fingerprint: 'f0',
      gridFingerprint: '',
    }))
    const commentOf = () => screen.getByTestId('field-comment') as HTMLInputElement
    const onDisk = new Map<string, string>()
    const phraseTwo = async (
      saveComments = vi.fn<Api['cues']['saveComments']>(async () => ({
        failed: [],
        unwritten: [],
      })),
      commentsToFile = false,
    ) => {
      onDisk.clear()
      await openFactory({
        readTags: vi.fn(async (path: string) => ({
          title: TITLES[path],
          artist: 'DJ',
          comment: onDisk.get(path) ?? 'Vocal fuerte',
        })),
        cues: { ...stubApi().cues, trackCues: analysed, saveComments },
        onCueProfileChanged: () => () => {},
        getSettings: vi
          .fn()
          .mockResolvedValue(settings({ visibleFields: ['title', 'comment'], commentsToFile })),
      })
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      fireEvent.click(await screen.findByTestId('cues-batch-phrases'))
      await screen.findByTestId('cues-batch-comments-save')
      return saveComments
    }

    it('gives the form its comment back once the count is saved to rekordbox, so a later Convert does not write it into the file', async () => {
      const saveComments = await phraseTwo()
      fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
      await waitFor(() =>
        expect(saveComments).toHaveBeenCalledWith(
          [
            {
              contentId: 'c-l1',
              path: '/m/a.wav',
              label: 'Alpha',
              count: '2 - 8',
              mode: 'prepend',
            },
            {
              contentId: 'c-l2',
              path: '/m/b.wav',
              label: 'Bravo',
              count: '2 - 8',
              mode: 'prepend',
            },
          ],
          false,
        ),
      )
      await waitFor(() =>
        expect(screen.queryByTestId('cues-batch-comments-save')).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      expect(commentOf().value).toBe('Vocal fuerte')
    })

    it('leaves a comment edited by hand after the phrases when discarding, so the DJ does not lose what was typed', async () => {
      const saveComments = await phraseTwo()
      fireEvent.change(commentOf(), { target: { value: 'Mine now' } })
      fireEvent.blur(commentOf())
      fireEvent.click(screen.getByTestId('cues-batch-comments-discard'))
      expect(saveComments).not.toHaveBeenCalled()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(commentOf().value).toBe('Mine now')
    })

    it('leaves a comment edited by hand after the phrases when saving, so the DJ does not lose what was typed', async () => {
      const saveComments = await phraseTwo()
      fireEvent.change(commentOf(), { target: { value: 'Mine now' } })
      fireEvent.blur(commentOf())
      fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
      await waitFor(() => expect(saveComments).toHaveBeenCalledTimes(1))
      await waitFor(() =>
        expect(screen.queryByTestId('cues-batch-comments-save')).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(commentOf().value).toBe('Mine now')
    })

    const phraseAgain = async () => {
      fireEvent.click(screen.getByTestId('cues-batch-phrases'))
      await waitFor(() => expect(screen.getByTestId('cues-batch-phrases')).toBeEnabled())
    }

    it('gives the form its first comment back when discarding phrases put twice, so the second press does not bury it', async () => {
      await phraseTwo()
      await phraseAgain()
      fireEvent.click(screen.getByTestId('cues-batch-comments-discard'))
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(commentOf().value).toBe('Vocal fuerte')
    })

    it('gives the form its first comment back when saving phrases put twice, so a later Convert does not write the count into the file', async () => {
      const saveComments = await phraseTwo()
      await phraseAgain()
      fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
      await waitFor(() =>
        expect(saveComments).toHaveBeenCalledWith(
          [
            {
              contentId: 'c-l1',
              path: '/m/a.wav',
              label: 'Alpha',
              count: '2 - 8',
              mode: 'prepend',
            },
            {
              contentId: 'c-l2',
              path: '/m/b.wav',
              label: 'Bravo',
              count: '2 - 8',
              mode: 'prepend',
            },
          ],
          false,
        ),
      )
      await waitFor(() =>
        expect(screen.queryByTestId('cues-batch-comments-save')).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(commentOf().value).toBe('Vocal fuerte')
    })

    it('after saving to the file the comment field shows the phrases instead of going back, as the file now holds them', async () => {
      const saveComments = vi.fn<Api['cues']['saveComments']>(async (items) => {
        for (const i of items) onDisk.set(i.path, `${i.count} · Vocal fuerte`)
        return { failed: [], unwritten: [] }
      })
      await phraseTwo(saveComments, true)
      fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
      await waitFor(() => expect(saveComments.mock.calls[0]?.[1]).toBe(true))
      await waitFor(() =>
        expect(screen.queryByTestId('cues-batch-comments-save')).not.toBeInTheDocument(),
      )
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      expect(commentOf().value).toBe('2 - 8 · Vocal fuerte')
    })

    it('rereads only the files that were written, so a track whose file write failed keeps its phrases pending', async () => {
      const saveComments = vi.fn<Api['cues']['saveComments']>(async () => ({
        failed: ['/m/b.wav'],
        unwritten: [],
      }))
      await phraseTwo(saveComments, true)
      const reads = (path: string) =>
        vi.mocked(window.api.readTags).mock.calls.filter(([p]) => p === path).length
      const [readsA, readsB] = [reads('/m/a.wav'), reads('/m/b.wav')]
      fireEvent.click(screen.getByTestId('cues-batch-comments-save'))
      expect(await screen.findByTestId('cues-batch-comments-failed')).toBeInTheDocument()
      expect(screen.getByTestId('cues-batch-comments-save')).toHaveTextContent('Save 1 comment')
      await waitFor(() => expect(reads('/m/a.wav')).toBeGreaterThan(readsA))
      expect(reads('/m/b.wav')).toBe(readsB)
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      expect(commentOf().value).toBe('2 - 8 · Vocal fuerte')
    })

    it('shows the count replacing the comment the moment Replace is picked, so the DJ sees what will be written', async () => {
      await phraseTwo()
      fireEvent.click(screen.getByTestId('cues-batch-comments-options'))
      fireEvent.click(screen.getByTestId('cues-batch-comments-replace'))
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      expect(commentOf().value).toBe('2 - 8')
    })

    it('gives the form its comment back when discarding, so nothing of the batch stays to be converted', async () => {
      await phraseTwo()
      fireEvent.click(screen.getByTestId('cues-batch-comments-discard'))
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(commentOf().value).toBe('Vocal fuerte')
    })
  })

  it('shows on each row of the open playlist what Auto marcar left for its rekordbox entry', async () => {
    await openFactory()
    act(() =>
      keepAutoMark('c-l2', {
        kind: 'proposed',
        proposals: [1000, 2000].map((ms) => ({ ms, sure: true, quietBars: 8 })),
      }),
    )
    const chips = () =>
      screen
        .getAllByTestId('track-wave-line')
        .map((row) => within(row).queryByTestId('track-auto-mark')?.textContent ?? null)
    await waitFor(() => expect(chips()).toEqual([null, '2 proposals', null]))
  })

  it('filters by an Auto mark tally line only the tracks of the batch it counts, not those of an earlier batch', async () => {
    await openFactory({
      cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) },
    })
    act(() => keepAutoMark('c-l1', { kind: 'marked' }))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[1])
    fireEvent.click(rows[2], { metaKey: true })
    act(() => {
      keepAutoMark('c-l2', { kind: 'marked' })
      keepAutoMark('c-l3', { kind: 'marked' })
    })
    expect(await screen.findByTestId('cues-batch-tally-marked')).toHaveTextContent(/2$/)
    fireEvent.click(screen.getByTestId('cues-batch-tally-marked'))
    await waitFor(() => expect(titles()).toHaveLength(2))
    expect(titles().join(' ')).not.toContain('Alpha')
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
    expect(await screen.findByTestId('quality-filter-autoMarkMarked')).toHaveTextContent(/2$/)
  })

  describe('the batch of an Auto mark tally line', () => {
    const noCues = { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) }

    async function pressMarkedOfBravoAndCharlie() {
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[1])
      fireEvent.click(rows[2], { metaKey: true })
      act(() => {
        keepAutoMark('c-l2', { kind: 'marked' })
        keepAutoMark('c-l3', { kind: 'marked' })
      })
      fireEvent.click(await screen.findByTestId('cues-batch-tally-marked'))
      await waitFor(() => expect(titles()).toHaveLength(2))
    }

    function markedFilterOffered(): boolean {
      fireEvent.click(screen.getByTestId('quality-filter-trigger'))
      fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
      const offered = screen.queryByTestId('quality-filter-autoMarkMarked') !== null
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      return offered
    }

    it('keeps the filter on the same tracks when one of them is opened, so the DJ can go through them one by one', async () => {
      await openFactory({ cues: noCues })
      await pressMarkedOfBravoAndCharlie()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await act(async () => {})
      expect(titles()).toHaveLength(2)
      expect(titles()[0]).toContain('Bravo')
      expect(titles()[1]).toContain('Charlie')
      fireEvent.click(screen.getByTestId('quality-filter-trigger'))
      fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
      expect(screen.getByTestId('quality-filter-autoMarkMarked')).toHaveTextContent(/2$/)
    })

    it('drops the filter on opening another playlist, since its batch belongs to the playlist left', async () => {
      await openFactory({
        cues: noCues,
        dj: djReads({
          rekordbox: {
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
              { id: 'f', name: 'Factory', kind: 'playlist', count: 3 },
              { id: 'h', name: 'House', kind: 'playlist', count: 2 },
            ]),
            playlist: vi.fn<ProgramReads['playlist']>(async (id) =>
              id === 'h' ? [linked('/m/a.wav', 'l1'), linked('/m/b.wav', 'l2')] : FACTORY_ENTRIES,
            ),
          },
        }),
      })
      await pressMarkedOfBravoAndCharlie()
      fireEvent.click(screen.getByTestId('source-node-h'))
      await waitFor(() => expect(titles()).toHaveLength(2))
      expect(titles()[0]).toContain('Alpha')
      expect(titles()[1]).toContain('Bravo')
      expect(markedFilterOffered()).toBe(false)
    })

    it('drops the filter on opening another program, since its batch belongs to the list left', async () => {
      await openFactory({
        cues: noCues,
        dj: djReads({
          engine: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 1 }]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockResolvedValue([
                { path: '/m/b.wav', separator: false, meta: {}, contentId: 'engine:12' },
              ]),
          },
        }),
      })
      await pressMarkedOfBravoAndCharlie()
      fireEvent.click(await screen.findByTestId('source-rail-engine'))
      fireEvent.click(await screen.findByTestId('source-node-7'))
      await waitFor(() => expect(titles()).toHaveLength(1))
      expect(markedFilterOffered()).toBe(false)
    })

    it('takes the batch anew on the next press once the filter was turned off', async () => {
      await openFactory({ cues: noCues })
      await pressMarkedOfBravoAndCharlie()
      fireEvent.click(screen.getByTestId('quality-filter-trigger'))
      fireEvent.click(screen.getByTestId('quality-filter-section-attention'))
      fireEvent.click(screen.getByTestId('quality-filter-autoMarkMarked'))
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      await waitFor(() => expect(titles()).toHaveLength(3))
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      act(() => keepAutoMark('c-l1', { kind: 'marked' }))
      fireEvent.click(await screen.findByTestId('cues-batch-tally-marked'))
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await waitFor(() => expect(titles()).toHaveLength(2))
      expect(titles()[0]).toContain('Alpha')
      expect(titles()[1]).toContain('Bravo')
    })
  })

  // The DJ's own request: put the set in order by dragging. The list must show the new
  // order at once and keep it after rekordbox answers, even with the dragged row selected
  // (a held selection otherwise freezes the order on screen).
  it('reorders an open rekordbox playlist by dragging a row onto another', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    const load = vi
      .fn<ProgramReads['playlist']>()
      .mockResolvedValueOnce(FACTORY_ENTRIES)
      .mockResolvedValue([
        FACTORY_ENTRIES[3],
        FACTORY_ENTRIES[0],
        FACTORY_ENTRIES[1],
        FACTORY_ENTRIES[2],
      ])
    await openFactory({
      dj: djReads({ rekordbox: { playlist: load, editPlaylist: edit } }),
      startTrackDrag: vi.fn(),
      getPathForFile: vi.fn((f: File) => `/m/${f.name}`),
    })
    vi.mocked(window.api.expandPaths).mockClear()
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[2])
    const charlie = rowWrapper(2)
    fireEvent.dragStart(charlie, { dataTransfer: fakeDataTransfer() })
    expect(window.api.startTrackDrag).toHaveBeenCalledWith(['/m/c.wav'], undefined)
    const back = fakeDataTransfer([new File([''], 'c.wav')])
    fireEvent.dragOver(rowWrapper(0), { dataTransfer: back, clientY: -1 })
    fireEvent.drop(rowWrapper(0), { dataTransfer: back })
    expect(window.api.expandPaths).not.toHaveBeenCalledWith(['/m/c.wav'])
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'move',
          playlistId: 'f',
          linkIds: ['l3'],
          beforeLinkId: 'l1',
        },
        'Factory',
      ),
    )
    await waitFor(() =>
      expect(titles()).toEqual([
        expect.stringContaining('Charlie'),
        expect.stringContaining('Alpha'),
        expect.stringContaining('Bravo'),
      ]),
    )
  })

  // Sorted by artist, a drop between two rows means nothing in the playlist's own order.
  // The reason is told when a drop is tried, not pinned above every sorted list: a DJ who
  // sorts to look, not to reorder, never needs it.
  it('does not reorder and says why only when a drop is tried out of playlist order', async () => {
    await openFactory()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    expectNoReorderLine()
    expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
    tryToReorder()
    expect(await screen.findByTestId('reorder-hint')).toHaveTextContent(
      'To reorder, sort by “Order” and clear the search and filters',
    )
  })

  // Opening another playlist of the same source hides the rows of the one left, yet they
  // stay in the working list. A selection kept across the switch made the editor, the row
  // menu and the bulk actions act on rows the DJ could no longer see, a rekordbox write
  // among them. Only what the new view shows may stay selected.
  describe('switching playlists inside rekordbox', () => {
    const HOUSE_ENTRIES = [linked('/m/b.wav', 'h2'), linked('/m/c.wav', 'h3')]
    const openThree = async (over: Record<string, unknown> = {}) => {
      await openFactory({
        ...over,
        dj: djReads(
          {
            rekordbox: {
              tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
                { id: 'f', name: 'Factory', kind: 'playlist', count: 3 },
                { id: 'h', name: 'House', kind: 'playlist', count: 2 },
                { id: 'g', name: 'Gym', kind: 'playlist', count: 0 },
              ]),
              playlist: vi.fn(async (id: string) =>
                id === 'h' ? HOUSE_ENTRIES : id === 'g' ? [] : FACTORY_ENTRIES,
              ),
            },
          },
          over.dj as DjApi | undefined,
        ),
      })
    }
    // The rows of the new playlist can paint a commit before the selection carried over to
    // them, so a test reading the selection waits for it rather than for the rows alone.
    const openHouse = async () => {
      fireEvent.click(screen.getByTestId('source-node-h'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    }
    const selectedTitles = () =>
      screen
        .getAllByTestId('track-row')
        .filter((r) => r.getAttribute('aria-selected') === 'true')
        .map((r) => r.textContent)

    it('adds only the rows of the open playlist to another one', async () => {
      const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({
        applied: true,
        report: { added: 2, already: 0, notInCollection: 0, ambiguous: 0 },
      })
      await openThree({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      fireEvent.click(rows[2], { metaKey: true })
      await openHouse()
      await waitFor(() =>
        expect(selectedTitles()).toEqual([
          expect.stringContaining('Bravo'),
          expect.stringContaining('Charlie'),
        ]),
      )
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      fireEvent.click(screen.getByTestId('track-menu-playlist-g'))
      await waitFor(() =>
        expect(edit).toHaveBeenCalledWith(
          {
            kind: 'add',
            playlistId: 'g',
            tracks: [
              { contentId: 'c-h2', paths: ['/m/b.wav'] },
              { contentId: 'c-h3', paths: ['/m/c.wav'] },
            ],
          },
          'Gym',
        ),
      )
    })

    it('closes the editor of a row the new playlist does not hold', async () => {
      await openThree()
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
      await openHouse()
      expect(selectedTitles()).toEqual([])
      expect(screen.queryByTestId('field-title')).not.toBeInTheDocument()
    })

    it('keeps the editor on a row the new playlist also holds', async () => {
      await openThree()
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))
      await openHouse()
      await waitFor(() => expect(selectedTitles()).toEqual([expect.stringContaining('Bravo')]))
      expect(screen.getByTestId('field-title')).toHaveValue('Bravo')
    })

    it('has no selection to trash when the new playlist holds none of it', async () => {
      await openThree()
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      fireEvent.click(screen.getByTestId('source-node-g'))
      await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
      runMenu('trash-selected')
      await act(async () => {})
      expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    })
  })

  // The open playlist can lose rows without a switch: removed from it here, or changed in
  // rekordbox and re-read. Those rows stay in the working list, and kept selected they went
  // into the next "Añadir a playlist" and the bulk actions without being on screen.
  describe('rows leaving the open playlist', () => {
    const openWithReread = async (after: typeof FACTORY_ENTRIES, edit = vi.fn()) => {
      edit.mockResolvedValue({ applied: true })
      const load = vi
        .fn<ProgramReads['playlist']>()
        .mockResolvedValueOnce(FACTORY_ENTRIES)
        .mockResolvedValue(after)
      await openFactory({
        dj: djReads({
          rekordbox: {
            playlist: vi.fn(async (id: string) => (id === 'f' ? load(id) : [])),
            editPlaylist: edit,
          },
        }),
      })
      return edit
    }

    it('drops rows removed from the playlist from the selection', async () => {
      const edit = await openWithReread([FACTORY_ENTRIES[1], FACTORY_ENTRIES[3]])
      const rows = screen.getAllByTestId('track-row')
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      fireEvent.contextMenu(rows[1])
      fireEvent.click(await screen.findByTestId('track-menu-remove-from'))
      fireEvent.click(await screen.findByTestId('confirm-ok'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      await waitFor(() => expect(screen.queryByTestId('field-title')).not.toBeInTheDocument())
      const charlie = screen.getAllByTestId('track-row')[0]
      fireEvent.click(charlie, { metaKey: true })
      fireEvent.contextMenu(charlie)
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      fireEvent.click(screen.getByTestId('track-menu-playlist-h'))
      await waitFor(() =>
        expect(edit).toHaveBeenLastCalledWith(
          {
            kind: 'add',
            playlistId: 'h',
            tracks: [{ contentId: 'c-l3', paths: ['/m/c.wav'] }],
          },
          'House',
        ),
      )
    })

    it('closes the editor of a row a re-read no longer finds in the playlist', async () => {
      await openWithReread([FACTORY_ENTRIES[2], FACTORY_ENTRIES[3]])
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
      fireEvent.click(screen.getByTestId('separator-remove-s1'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      expect(screen.queryByTestId('field-title')).not.toBeInTheDocument()
      runMenu('trash-selected')
      await act(async () => {})
      expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    })
  })

  it('keeps a row on screen and selected after its conversion moved the file, before rekordbox follows', async () => {
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/m/a.aiff',
      inPlace: true,
    })
    await openFactory({ processTrack })
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    await act(async () => {})
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
  })

  it('reads the open playlist again after a conversion moved a file, so rekordbox’s repoint shows', async () => {
    const load = vi.fn<ProgramReads['playlist']>().mockResolvedValue(FACTORY_ENTRIES)
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/m/a.aiff',
      inPlace: true,
    })
    await openFactory({ processTrack, dj: djReads({ rekordbox: { playlist: load } }) })
    const reads = load.mock.calls.length
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(reads))
  })

  // The opening fills the BPM rekordbox holds; a BPM the DJ then clears stays cleared
  // through the re-read every edit makes.
  it('fills a loaded row from its playlist on opening only, not on an edit re-read', async () => {
    const withBpm = FACTORY_ENTRIES.map((e) =>
      e.path === '/m/a.wav' ? { ...e, meta: { bpm: '124' } } : e,
    )
    await openFactory({
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ visibleFields: ['title', 'artist', 'bpm'] })),
      dj: djReads({
        rekordbox: {
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValueOnce(withBpm)
            .mockResolvedValue(withBpm.filter((e) => !e.separator)),
        },
      }),
    })
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    const bpm = await screen.findByTestId('field-bpm')
    await waitFor(() => expect(bpm).toHaveValue('124'))
    fireEvent.change(bpm, { target: { value: '' } })
    fireEvent.blur(bpm)
    fireEvent.click(screen.getByTestId('separator-remove-s1'))
    await waitFor(() => expect(screen.queryByTestId('track-separator-s1')).not.toBeInTheDocument())
    await act(async () => {})
    expect(screen.getByTestId('field-bpm')).toHaveValue('')
  })

  // Copying between playlists names the exact rekordbox entry of a row read from a
  // playlist, so the symlinked twins copy instead of being refused.
  it('adds a row to another playlist from its menu, naming its rekordbox entry', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({
      applied: true,
      report: { added: 1, already: 0, notInCollection: 0, ambiguous: 0 },
    })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('track-menu-add-to'))
    fireEvent.click(screen.getByTestId('track-menu-playlist-h'))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'add',
          playlistId: 'h',
          tracks: [{ contentId: 'c-l1', paths: ['/m/a.wav'] }],
        },
        'House',
      ),
    )
    expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
      '1 track added to “House”',
    )
  })

  it('says the change waits and re-reads the playlist when rekordbox stays open', async () => {
    const load = vi.fn<ProgramReads['playlist']>().mockResolvedValue(FACTORY_ENTRIES)
    const edit = vi
      .fn<ProgramReads['editPlaylist']>()
      .mockResolvedValue({ applied: false, reason: 'cancelled' })
    await openFactory({
      dj: djReads({ rekordbox: { playlist: load, editPlaylist: edit } }),
    })
    const before = load.mock.calls.length
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
    fireEvent.click(await screen.findByTestId('track-menu-remove-from'))
    // Removing deletes rows of the DJ's real playlist: the link sent must be the clicked row's.
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l2'] },
        'Factory',
      ),
    )
    expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
      'rekordbox is still open. The change will apply when you close it',
    )
    expect(load.mock.calls.length).toBeGreaterThan(before)
  })

  // Cancel means nothing happened: a DJ who built a range with Shift+↓ in their rekordbox
  // playlist, pressed ⌫ and thought better of it must get the same range back.
  it('keeps the keyboard range selected and focused when the playlist removal is cancelled', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(rows[1], { key: 'Backspace' })
    fireEvent.click(await screen.findByTestId('confirm-cancel'))

    await waitFor(() => expect(screen.queryByTestId('confirm-cancel')).not.toBeInTheDocument())
    expect(edit).not.toHaveBeenCalled()
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    expect(rows[2]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveFocus()
  })

  // Removing from the DJ's real playlist has no undo in Surco: one row goes in one click
  // like the list's own remove, several ask first and name the playlist they leave.
  it('asks before removing several rows from the rekordbox playlist', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.contextMenu(rows[1])
    expect(await screen.findByTestId('track-menu-remove-from')).toHaveTextContent(
      /^Remove from “Factory”$/,
    )
    fireEvent.click(screen.getByTestId('track-menu-remove-from'))
    expect(edit).not.toHaveBeenCalled()
    expect(await screen.findByText('Remove 2 tracks from “Factory”?')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('confirm-ok'))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l1', 'l2'] },
        'Factory',
      ),
    )
  })

  // Inside a playlist, taking a track out of the list and out of the playlist were two actions
  // and the DJ could not tell them apart; now every way to remove reaches the playlist.
  it('removes from the open rekordbox playlist with the key and with the list button too', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true })
    await waitFor(() =>
      expect(edit).toHaveBeenLastCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l2'] },
        'Factory',
      ),
    )
    fireEvent.keyDown(screen.getAllByTestId('track-row')[0], { key: 'Backspace' })
    await waitFor(() =>
      expect(edit).toHaveBeenLastCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l1'] },
        'Factory',
      ),
    )
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getByTestId('remove-selected')).toHaveAttribute(
        'aria-label',
        'Remove from “Factory”',
      ),
    )
    edit.mockClear()
    fireEvent.click(screen.getByTestId('remove-selected'))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l2'] },
        'Factory',
      ),
    )
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    await screen.findByTestId('track-menu-remove-from')
    expect(screen.queryByTestId('track-menu-remove')).not.toBeInTheDocument()
  })

  // The separator line's ✕ is mouse-only; the row menu is the keyboard's way to remove the
  // separator above a row, and a row with none above offers nothing.
  it('removes the separator above a row from its menu', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    await screen.findByTestId('track-menu-remove-from')
    expect(screen.queryByTestId('track-menu-remove-separator')).not.toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
    fireEvent.click(await screen.findByTestId('track-menu-remove-separator'))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['s1'] },
        'Factory',
      ),
    )
  })

  // Sorted another way the separators are not drawn, and "above" would name one the DJ
  // cannot see, above the row in an order that is not on screen.
  it('offers no separator removal from the row menu when separators are not drawn', async () => {
    await openFactory()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    const bravo = screen
      .getAllByTestId('track-row')
      .find((r) => r.textContent?.includes('Bravo')) as HTMLElement
    fireEvent.contextMenu(bravo)
    await screen.findByTestId('track-menu-remove-from')
    expect(screen.queryByTestId('track-menu-remove-separator')).not.toBeInTheDocument()
  })

  // The separator lands above the right-clicked row, so the edit names that row's link.
  it('inserts a separator above the right-clicked row', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[2])
    const insert = await screen.findByTestId('track-menu-insert-separator')
    await waitFor(() => expect(insert).toBeEnabled())
    fireEvent.click(insert)
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'insertSeparator',
          playlistId: 'f',
          beforeLinkId: 'l3',
        },
        'Factory',
      ),
    )
  })

  describe('Recently added', () => {
    const fresh = (path: string, id: string) => ({
      path,
      separator: false,
      meta: {},
      linkId: id,
      contentId: id,
    })
    const RECENT_ENTRIES = [fresh('/m/c.wav', 'r3'), fresh('/m/a.wav', 'r1')]

    async function openRecent(over: Record<string, unknown> = {}) {
      await openFactory({
        ...over,
        dj: djReads(
          {
            rekordbox: {
              recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(2),
              playlist: vi
                .fn<ProgramReads['playlist']>()
                .mockImplementation(async (id) =>
                  id === RECENTLY_ADDED_ID ? RECENT_ENTRIES : FACTORY_ENTRIES,
                ),
            },
          },
          over.dj as DjApi | undefined,
        ),
      })
      fireEvent.click(screen.getByTestId(`source-node-${RECENTLY_ADDED_ID}`))
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
    }

    // Its order is when each track entered the collection, and it has no rows in rekordbox
    // to remove or move: any of these edits would name a playlist rekordbox does not have.
    it('offers no reorder, removal or separator on its rows', async () => {
      await openRecent()
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-remove-separator')).not.toBeInTheDocument()
    })

    it('copies its rows to a playlist by their rekordbox entry, like any open playlist', async () => {
      const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
      await openRecent({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      fireEvent.click(screen.getByTestId('track-menu-playlist-h'))
      await waitFor(() =>
        expect(edit).toHaveBeenCalledWith(
          { kind: 'add', playlistId: 'h', tracks: [{ contentId: 'r3', paths: ['/m/c.wav'] }] },
          'House',
        ),
      )
    })

    it('is never offered as a playlist to add tracks to', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: { recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(2) },
        }),
      })
      await screen.findByTestId(`source-node-${RECENTLY_ADDED_ID}`)
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      expect(screen.getByTestId('track-menu-playlist-h')).toBeInTheDocument()
      expect(
        screen.queryByTestId(`track-menu-playlist-${RECENTLY_ADDED_ID}`),
      ).not.toBeInTheDocument()
    })

    it('shows Engine DJ’s first with the same clock, opening read-only rows like rekordbox’s', async () => {
      setApi({
        readTags: vi.fn(async (path: string) => ({ title: TITLES[path], artist: 'DJ' })),
        dj: djReads({
          engine: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 3 }]),
            recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(2),
            trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(40),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) => (id === RECENTLY_ADDED_ID ? RECENT_ENTRIES : [])),
          },
        }),
        startTrackDrag: vi.fn(),
      })
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-engine'))
      const all = await screen.findByTestId(`source-node-${ALL_TRACKS_ID}`)
      const recent = await screen.findByTestId(`source-node-${RECENTLY_ADDED_ID}`)
      expect(
        screen
          .getAllByTestId(/^source-node-/)
          .filter((n) => n.tagName === 'BUTTON')
          .slice(0, 2),
      ).toEqual([recent, all])
      expect(within(recent).getByTestId('source-node-recent-icon')).toBeInTheDocument()
      fireEvent.click(recent)
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    })
  })

  describe('rekordbox smart playlists', () => {
    const SMART_ENTRIES = [
      { path: '/m/c.wav', separator: false, meta: {}, linkId: 'r3', contentId: 'r3' },
      { path: '/m/a.wav', separator: false, meta: {}, linkId: 'r1', contentId: 'r1' },
    ]
    const smartReads = () =>
      djReads({
        rekordbox: {
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: 'f', name: 'Factory', kind: 'playlist', count: 3 },
            { id: 'h', name: 'House', kind: 'playlist', count: 0 },
            { id: 'sm', name: 'Electronic 2026', kind: 'playlist', count: 2, smart: true },
          ]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockImplementation(async (id) => (id === 'sm' ? SMART_ENTRIES : FACTORY_ENTRIES)),
        },
      })

    // rekordbox fills it from its rules and refuses any edit on it, so removing or moving a
    // row would only come back refused.
    it('offers no reorder, removal or separator on its rows', async () => {
      await openFactory({ dj: smartReads() })
      fireEvent.click(screen.getByTestId('source-node-sm'))
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    })

    it('is never offered as a playlist to add tracks to', async () => {
      await openFactory({ dj: smartReads() })
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      expect(screen.getByTestId('track-menu-playlist-h')).toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-playlist-sm')).not.toBeInTheDocument()
    })
  })

  describe('To review', () => {
    const ALL_ENTRIES = [
      { path: '/m/c.wav', separator: false, meta: {}, linkId: 'r3', contentId: 'r3' },
      { path: '/m/a.wav', separator: false, meta: {}, linkId: 'r1', contentId: 'r1' },
    ]
    const REPLACED = [
      {
        newPath: '/m/c.wav',
        oldPath: '/m/c.mp3',
        replacedAt: 2,
        shift: { moved: 40 },
        pending: ['rekordbox'],
      },
      {
        newPath: '/m/a.wav',
        oldPath: '/m/a.mp3',
        replacedAt: 1,
        shift: { moved: -20 },
        pending: ['rekordbox'],
      },
    ]
    const reviewReads = () =>
      djReads({
        rekordbox: {
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockImplementation(async (id) =>
              id === ALL_TRACKS_ID ? ALL_ENTRIES : FACTORY_ENTRIES,
            ),
        },
      })

    // Its rows are Surco's list of replaced tracks, not a playlist in rekordbox: a reorder,
    // removal or separator would name a playlist rekordbox does not have.
    it('opens To review with no reorder, removal or separator on its rows', async () => {
      await openFactory({
        replacedTracks: vi.fn().mockResolvedValue(REPLACED),
        dj: reviewReads(),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${TO_REVIEW_ID}`))
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    })

    // Its order is Surco's review priority, unmoved tracks first, not an order the DJ set,
    // so numbers down the side would read as positions in a playlist that does not exist.
    it('leaves position numbers out of To review, whose order is not one the DJ set', async () => {
      await openFactory({
        replacedTracks: vi.fn().mockResolvedValue(REPLACED),
        dj: reviewReads(),
      })
      await waitFor(() => expect(screen.getAllByTestId('track-number').length).toBeGreaterThan(0))
      fireEvent.click(await screen.findByTestId(`source-node-${TO_REVIEW_ID}`))
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('track-number')).not.toBeInTheDocument()
    })

    // The icon says what Surco did to a replaced track's cues, so it matters only where the DJ
    // reviews them: the same files in an ordinary playlist are just tracks.
    it('marks To review rows by new or old path with their state, and no row anywhere else', async () => {
      await openFactory({
        replacedTracks: vi.fn().mockResolvedValue([
          { ...REPLACED[0] },
          {
            newPath: '/m/a.wav',
            oldPath: '/m/a.mp3',
            replacedAt: 1,
            shift: { unmoved: 'drift' },
            pending: ['rekordbox'],
          },
        ]),
        dj: djReads({
          rekordbox: {
            playlist: vi.fn<ProgramReads['playlist']>().mockImplementation(async (id) =>
              id === ALL_TRACKS_ID
                ? [
                    { path: '/m/c.wav', separator: false, meta: {}, linkId: 'r3', contentId: 'r3' },
                    { path: '/m/a.mp3', separator: false, meta: {}, linkId: 'r1', contentId: 'r1' },
                  ]
                : FACTORY_ENTRIES,
            ),
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${TO_REVIEW_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-replaced')).toHaveLength(2))
      expect(
        screen.getAllByTestId('track-replaced').map((el) => el.getAttribute('data-state')),
      ).toEqual(['unmoved', 'moved'])
      fireEvent.click(screen.getByTestId('source-node-h'))
      await waitFor(() => expect(screen.getAllByTestId('track-row').length).toBeGreaterThan(0))
      expect(screen.queryByTestId('track-replaced')).not.toBeInTheDocument()
    })

    // Right after Update the row is the Tracks item that made the new file: its own path is
    // the download, and only the file it wrote is the one To review lists.
    it('marks and opens a track replaced in this session by the file the replacement wrote', async () => {
      const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
        outputPath: '/m/a.aiff',
        inPlace: false,
      })
      await openFactory({
        processTrack,
        replacedTracks: vi.fn().mockResolvedValue([
          {
            newPath: '/m/a.aiff',
            oldPath: '/m/a.mp3',
            replacedAt: 1,
            shift: { moved: 40 },
            pending: ['rekordbox'],
          },
        ]),
        dj: djReads({
          rekordbox: {
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === ALL_TRACKS_ID
                  ? [
                      {
                        path: '/m/a.aiff',
                        separator: false,
                        meta: {},
                        linkId: 'r1',
                        contentId: 'r1',
                      },
                    ]
                  : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('process-btn'))
      await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
      await act(async () => {})
      fireEvent.click(await screen.findByTestId(`source-node-${TO_REVIEW_ID}`))
      await waitFor(() => expect(titles()).toEqual([expect.stringContaining('Alpha')]))
      expect(screen.getByTestId('track-replaced')).toHaveAttribute('data-state', 'moved')
      fireEvent.click(screen.getAllByTestId('track-row')[0])
      expect(await screen.findByTestId('cues-replaced-pill')).toHaveAttribute('data-state', 'moved')
      expect(screen.getByTestId('cues-reviewed')).toBeInTheDocument()
    })

    it('gives no icon for a track pending review only in another program', async () => {
      await openFactory({
        replacedTracks: vi
          .fn()
          .mockResolvedValue([REPLACED[0], { ...REPLACED[1], pending: ['traktor'] }]),
        dj: reviewReads(),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${TO_REVIEW_ID}`))
      await waitFor(() => expect(screen.getAllByTestId('track-replaced')).toHaveLength(1))
      expect(screen.getAllByTestId('track-row')).toHaveLength(1)
    })

    it('is never offered as a playlist to add tracks to', async () => {
      await openFactory({
        replacedTracks: vi.fn().mockResolvedValue(REPLACED),
        dj: reviewReads(),
      })
      await screen.findByTestId(`source-node-${TO_REVIEW_ID}`)
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      expect(screen.getByTestId('track-menu-playlist-h')).toBeInTheDocument()
      expect(screen.queryByTestId(`track-menu-playlist-${TO_REVIEW_ID}`)).not.toBeInTheDocument()
    })
  })

  describe('All tracks', () => {
    const ALL_ENTRIES = [
      { path: '/m/c.wav', separator: false, meta: {}, linkId: 'r3', contentId: 'r3' },
      { path: '/m/a.wav', separator: false, meta: {}, linkId: 'r1', contentId: 'r1' },
    ]

    // A track in no playlist is found only here, and the rows it lists are the collection
    // itself: a reorder, removal or separator would name a playlist rekordbox does not have.
    it('opens the whole collection with no reorder, removal or separator on its rows', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: {
            trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(2078),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === ALL_TRACKS_ID ? ALL_ENTRIES : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      const all = screen.getByTestId(`source-node-${ALL_TRACKS_ID}`)
      expect(all).toHaveTextContent(formatCount(2078, i18n.language))
      fireEvent.click(all)
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    })

    it('is never offered as a playlist to add tracks to', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: { trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(2078) },
        }),
      })
      await screen.findByTestId(`source-node-${ALL_TRACKS_ID}`)
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      expect(screen.getByTestId('track-menu-playlist-h')).toBeInTheDocument()
      expect(screen.queryByTestId(`track-menu-playlist-${ALL_TRACKS_ID}`)).not.toBeInTheDocument()
    })

    it('opens Matching with no reorder, removal or separator on its rows', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: {
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r3', 'r1']]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === MATCHING_ID ? ALL_ENTRIES : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() =>
        expect(titles()).toEqual([
          expect.stringContaining('Charlie'),
          expect.stringContaining('Alpha'),
        ]),
      )
      expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
      expectNoReorderLine()
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      await screen.findByTestId('track-menu-add-to')
      expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
      expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
    })

    it('creates a rekordbox playlist with the paired tracks in the order Matching lists them', async () => {
      const editPlaylist = vi
        .fn<ProgramReads['editPlaylist']>()
        .mockResolvedValue({ applied: true, createdId: 'new' })
      await openFactory({
        dj: djReads({
          rekordbox: {
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r3', 'r1']]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === MATCHING_ID ? ALL_ENTRIES : FACTORY_ENTRIES,
              ),
            editPlaylist,
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(titles()).toHaveLength(2))
      fireEvent.click(screen.getByTestId('matching-create-playlist'))
      await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
      expect(editPlaylist.mock.calls[0][0]).toMatchObject({
        kind: 'create',
        parentId: 'root',
        name: 'Matching',
        folder: false,
        tracks: [{ contentId: 'r3' }, { contentId: 'r1' }],
      })
    })

    it('keeps Create playlist in the sticky list header, so it stays in reach after scrolling to the blocks', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: {
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r3', 'r1']]),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) =>
                id === MATCHING_ID ? ALL_ENTRIES : FACTORY_ENTRIES,
              ),
          },
        }),
      })
      fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
      await waitFor(() => expect(titles()).toHaveLength(2))
      expect(
        within(screen.getByTestId('track-list-toolbar')).getByTestId('matching-create-playlist'),
      ).toBeInTheDocument()
      expect(screen.queryByTestId('matching-suggestions-toggle')).not.toBeInTheDocument()
    })

    describe('with tracks selected', () => {
      const BLOCKS = [
        { path: '/m/c.wav', separator: false, meta: {}, linkId: 'r3', contentId: 'r3' },
        { path: '/m/a.wav', separator: false, meta: {}, linkId: 'r1', contentId: 'r1' },
        { path: '/m/_.mp3', separator: true, meta: {}, linkId: 'm1', contentId: 'm1' },
        { path: '/m/b.wav', separator: false, meta: {}, linkId: 'r2', contentId: 'r2' },
      ]
      const createFromSelection = async (pick: string) => {
        const editPlaylist = vi
          .fn<ProgramReads['editPlaylist']>()
          .mockResolvedValue({ applied: true, createdId: 'new' })
        await openFactory({
          dj: djReads({
            rekordbox: {
              matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r3', 'r1']]),
              playlist: vi
                .fn<ProgramReads['playlist']>()
                .mockImplementation(async (id) => (id === MATCHING_ID ? BLOCKS : FACTORY_ENTRIES)),
              editPlaylist,
            },
          }),
        })
        fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
        await waitFor(() => expect(titles()).toHaveLength(3))
        fireEvent.click(
          screen
            .getAllByTestId('track-row')
            .find((r) => r.textContent?.includes(pick)) as HTMLElement,
        )
        fireEvent.click(screen.getByTestId('matching-create-playlist'))
        await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
        return editPlaylist.mock.calls[0][0]
      }

      it('takes only the block of the chosen track, so the DJ builds a playlist from a few pairs', async () => {
        expect(await createFromSelection('Bravo')).toMatchObject({
          kind: 'create',
          tracks: [{ contentId: 'r2' }],
        })
      })

      it('takes the whole block even when the chosen track is only one of its pairs', async () => {
        expect(await createFromSelection('Alpha')).toMatchObject({
          kind: 'create',
          tracks: [{ contentId: 'r3' }, { contentId: 'r1' }],
        })
      })

      it('finds the searched track with its whole block, since its pairs are why it is there', async () => {
        await openFactory({
          dj: djReads({
            rekordbox: {
              matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r3', 'r1']]),
              playlist: vi
                .fn<ProgramReads['playlist']>()
                .mockImplementation(async (id) => (id === MATCHING_ID ? BLOCKS : FACTORY_ENTRIES)),
            },
          }),
        })
        fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
        await waitFor(() => expect(titles()).toHaveLength(3))
        fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'Alpha' } })
        await waitFor(() => expect(titles()).toHaveLength(2))
        expect(titles().join()).toContain('Charlie')
        expect(titles().join()).not.toContain('Bravo')
      })
    })

    describe('with a track in two blocks', () => {
      const entryOf = (id: string, path: string) => ({
        path,
        separator: false,
        meta: {},
        linkId: id,
        contentId: id,
      })
      const TWO_BLOCKS = [
        entryOf('r1', '/m/a.wav'),
        entryOf('r2', '/m/b.wav'),
        entryOf('r3', '/m/c.wav'),
        { path: null, separator: true, meta: {}, linkId: 'matching-sep-1' },
        entryOf('r3', '/m/c.wav'),
        entryOf('r4', '/m/d.wav'),
      ]
      const openTwoBlocks = async (editPlaylist = vi.fn<ProgramReads['editPlaylist']>()) => {
        await openFactory(
          {
            pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav', '/m/d.wav']),
            dj: djReads({
              rekordbox: {
                matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([
                  ['r1', 'r2'],
                  ['r1', 'r3'],
                  ['r3', 'r4'],
                ]),
                playlist: vi
                  .fn<ProgramReads['playlist']>()
                  .mockImplementation(async (id) =>
                    id === MATCHING_ID ? TWO_BLOCKS : FACTORY_ENTRIES,
                  ),
                editPlaylist,
              },
            }),
          },
          4,
        )
        fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
        await waitFor(() => expect(titles()).toHaveLength(5))
      }

      it('shows it in each block, since each block is one track and the tracks played after it', async () => {
        await openTwoBlocks()
        expect(titles().filter((t) => t.includes('Charlie'))).toHaveLength(2)
        expect(screen.getByTestId('track-separator-matching-sep-1')).toBeInTheDocument()
      })

      it('puts it in the new playlist once, since the playlist holds tracks, not rows', async () => {
        const editPlaylist = vi
          .fn<ProgramReads['editPlaylist']>()
          .mockResolvedValue({ applied: true, createdId: 'new' })
        await openTwoBlocks(editPlaylist)
        fireEvent.click(screen.getByTestId('matching-create-playlist'))
        await waitFor(() => expect(editPlaylist).toHaveBeenCalled())
        expect(editPlaylist.mock.calls[0][0]).toMatchObject({
          tracks: [
            { contentId: 'r1' },
            { contentId: 'r2' },
            { contentId: 'r3' },
            { contentId: 'r4' },
          ],
        })
      })

      it('counts it once in the review the list menu offers, since the review reads tracks', async () => {
        await openTwoBlocks()
        fireEvent.click(screen.getByTestId('list-actions-more'))
        expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent('The 4 tracks')
      })

      it('shows it once under another sort, where no break tells its two blocks apart', async () => {
        await openTwoBlocks()
        fireEvent.click(screen.getByTestId('track-sort'))
        fireEvent.click(screen.getByTestId('track-sort-option-artist'))
        await waitFor(() => expect(titles()).toHaveLength(4))
      })

      it('moves past it with the down arrow instead of stopping on its second row', async () => {
        await openTwoBlocks()
        const charlie = screen
          .getAllByTestId('track-row')
          .find((r) => r.textContent?.includes('Charlie')) as HTMLElement
        fireEvent.click(charlie)
        fireEvent.keyDown(window, { key: 'ArrowDown' })
        await waitFor(() =>
          expect(
            screen.getAllByTestId('track-row').find((r) => r.textContent?.includes('Delta')),
          ).toHaveAttribute('aria-selected', 'true'),
        )
      })
    })

    describe('editing a block from the row menu', () => {
      const entryOf = (id: string, path: string) => ({
        path,
        separator: false,
        meta: {},
        linkId: id,
        contentId: id,
      })
      const separator = { path: null, separator: true, meta: {}, linkId: 'matching-sep-1' }
      const openBlock = async (
        pairs: [string, string][],
        entries: (ReturnType<typeof entryOf> | typeof separator)[],
        files = ['/m/a.wav', '/m/b.wav', '/m/c.wav'],
      ) => {
        const match = vi.fn<ProgramReads['match']>().mockResolvedValue({ applied: true })
        await openFactory(
          {
            pickFiles: vi.fn().mockResolvedValue(files),
            dj: djReads({
              rekordbox: {
                matching: vi.fn<ProgramReads['matching']>().mockResolvedValue(pairs),
                playlist: vi
                  .fn<ProgramReads['playlist']>()
                  .mockImplementation(async (id) =>
                    id === MATCHING_ID ? entries : FACTORY_ENTRIES,
                  ),
                match,
              },
            }),
          },
          files.length,
        )
        fireEvent.click(await screen.findByTestId(`source-node-${MATCHING_ID}`))
        await waitFor(() =>
          expect(titles()).toHaveLength(entries.filter((e) => !e.separator).length),
        )
        return match
      }
      const FOUR = ['/m/a.wav', '/m/b.wav', '/m/c.wav', '/m/d.wav']
      const openSharedBlocks = () =>
        openBlock(
          [
            ['r1', 'r2'],
            ['r1', 'r3'],
            ['r3', 'r4'],
          ],
          [
            entryOf('r1', '/m/a.wav'),
            entryOf('r2', '/m/b.wav'),
            entryOf('r3', '/m/c.wav'),
            separator,
            entryOf('r3', '/m/c.wav'),
            entryOf('r4', '/m/d.wav'),
          ],
          FOUR,
        )
      const openApartBlocks = () =>
        openBlock(
          [
            ['r1', 'r2'],
            ['r5', 'r6'],
          ],
          [
            entryOf('r1', '/m/a.wav'),
            entryOf('r2', '/m/b.wav'),
            separator,
            entryOf('r5', '/m/c.wav'),
            entryOf('r6', '/m/d.wav'),
          ],
          FOUR,
        )
      const selectRows = (...at: number[]) => {
        const rows = () => screen.getAllByTestId('track-row')
        fireEvent.click(rows()[at[0]])
        for (const i of at.slice(1)) fireEvent.click(rows()[i], { metaKey: true })
      }
      const openPair = () =>
        openBlock([['r1', 'r2']], [entryOf('r1', '/m/a.wav'), entryOf('r2', '/m/b.wav')])
      const openTrio = () =>
        openBlock(
          [
            ['r1', 'r2'],
            ['r1', 'r3'],
          ],
          [entryOf('r1', '/m/a.wav'), entryOf('r2', '/m/b.wav'), entryOf('r3', '/m/c.wav')],
        )
      const calls = (match: ReturnType<typeof vi.fn>) =>
        match.mock.calls.map(([action, pair]) => [action, pair])

      it('reverses a pair from its second row, so the DJ plays them the other way round', async () => {
        const match = await openPair()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() =>
          expect(calls(match)).toEqual([
            ['remove', ['r1', 'r2']],
            ['add', ['r2', 'r1']],
          ]),
        )
      })

      it('waits for rekordbox to drop the old pair before saving the reversed one', async () => {
        const match = await openPair()
        let release: (value: { applied: true }) => void = () => {}
        match.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(1))
        await act(async () => {})
        expect(match).toHaveBeenCalledTimes(1)
        release({ applied: true })
        await waitFor(() =>
          expect(match).toHaveBeenCalledWith('add', ['r2', 'r1'], expect.any(String)),
        )
      })

      it('says the change waits for rekordbox when one step is queued, even if the last one lands', async () => {
        const match = await openPair()
        match
          .mockResolvedValueOnce({ applied: false, queued: true, opId: 'op1' })
          .mockResolvedValueOnce({ applied: true })
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(2))
        expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
          'rekordbox is still open. The change will apply when you close it',
        )
      })

      it('stops after a refused step, so rekordbox never holds a pair both ways round', async () => {
        const match = await openPair()
        match.mockResolvedValueOnce({ applied: false, reason: 'write-failed' })
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(1))
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(calls(match)).toEqual([['remove', ['r1', 'r2']]])
      })

      it('asks about an open rekordbox once for the whole change, not once per pair', async () => {
        const match = await openPair()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(2))
        expect(window.api.dj.askToApply).toHaveBeenCalledTimes(1)
      })

      it('reverses a pair from its first row too, since a block of two is just that pair', async () => {
        const match = await openPair()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() =>
          expect(calls(match)).toEqual([
            ['remove', ['r1', 'r2']],
            ['add', ['r2', 'r1']],
          ]),
        )
      })

      it('takes the head out of a block of two by dropping its only pair', async () => {
        const match = await openPair()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(await screen.findByTestId('track-menu-leave-match'))
        await waitFor(() => expect(calls(match)).toEqual([['remove', ['r1', 'r2']]]))
      })

      it('offers only the unpairing of two selected tracks when it shows, so the menu never says the same twice', async () => {
        await openPair()
        fireEvent.click(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getAllByTestId('track-row')[1], { metaKey: true })
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        await screen.findByTestId('track-menu-unmatch')
        expect(screen.queryByTestId('track-menu-leave-match')).not.toBeInTheDocument()
      })

      it('takes a follower out of a block of three without touching the other pair', async () => {
        const match = await openTrio()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[2])
        fireEvent.click(await screen.findByTestId('track-menu-leave-match'))
        await waitFor(() => expect(calls(match)).toEqual([['remove', ['r1', 'r3']]]))
      })

      it('takes the head out of a block of three and keeps the rest together under the next track', async () => {
        const match = await openTrio()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(await screen.findByTestId('track-menu-leave-match'))
        await waitFor(() =>
          expect(calls(match)).toEqual([
            ['remove', ['r1', 'r2']],
            ['remove', ['r1', 'r3']],
            ['add', ['r2', 'r3']],
          ]),
        )
      })

      it('offers no reversing on the head of a block of three, since there is no single pair to flip', async () => {
        await openTrio()
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        await screen.findByTestId('track-menu-leave-match')
        expect(screen.queryByTestId('track-menu-reverse-match')).not.toBeInTheDocument()
      })

      it('merges two blocks under the first head, leaving out the track that already follows it', async () => {
        const match = await openSharedBlocks()
        selectRows(1, 4)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[4])
        fireEvent.click(await screen.findByTestId('track-menu-merge-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(2))
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(calls(match)).toEqual([
          ['remove', ['r3', 'r4']],
          ['add', ['r1', 'r4']],
        ])
      })

      it('merges two separate blocks by moving the second head and its followers under the first head', async () => {
        const match = await openApartBlocks()
        selectRows(0, 3)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[3])
        fireEvent.click(await screen.findByTestId('track-menu-merge-match'))
        await waitFor(() =>
          expect(calls(match)).toEqual([
            ['remove', ['r5', 'r6']],
            ['add', ['r1', 'r5']],
            ['add', ['r1', 'r6']],
          ]),
        )
      })

      it('merges under a head that follows in the other block by dropping that pair before pairing them the other way, so rekordbox never holds both', async () => {
        const match = await openBlock(
          [
            ['r1', 'r2'],
            ['r3', 'r1'],
          ],
          [
            entryOf('r1', '/m/a.wav'),
            entryOf('r2', '/m/b.wav'),
            separator,
            entryOf('r3', '/m/c.wav'),
            entryOf('r1', '/m/a.wav'),
          ],
        )
        selectRows(1, 2)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[2])
        fireEvent.click(await screen.findByTestId('track-menu-merge-match'))
        await waitFor(() =>
          expect(calls(match)).toEqual([
            ['remove', ['r3', 'r1']],
            ['add', ['r1', 'r3']],
          ]),
        )
      })

      it('offers no merging for a single row, since one block has nothing to merge with', async () => {
        await openApartBlocks()
        selectRows(3)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[3])
        await screen.findByTestId('track-menu-leave-match')
        expect(screen.queryByTestId('track-menu-merge-match')).not.toBeInTheDocument()
      })

      it('offers no merging for rows of the same block, since they are one block already', async () => {
        await openApartBlocks()
        selectRows(2, 3)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[3])
        await screen.findByTestId('track-menu-unmatch')
        expect(screen.queryByTestId('track-menu-merge-match')).not.toBeInTheDocument()
      })

      it('offers no merging for one track that sits in two blocks, since merging takes two tracks', async () => {
        await openSharedBlocks()
        selectRows(2)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[2])
        await screen.findByTestId('track-menu-leave-match')
        expect(screen.queryByTestId('track-menu-merge-match')).not.toBeInTheDocument()
      })

      it('offers only merging for two tracks of different blocks, since reversing and leaving act on one row', async () => {
        await openApartBlocks()
        selectRows(1, 3)
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[3])
        await screen.findByTestId('track-menu-merge-match')
        expect(screen.queryByTestId('track-menu-reverse-match')).not.toBeInTheDocument()
        expect(screen.queryByTestId('track-menu-leave-match')).not.toBeInTheDocument()
      })

      it('keeps the pair of a refused step out of Surco, so Surco never holds a pair rekordbox refused', async () => {
        const match = await openPair()
        match
          .mockResolvedValueOnce({ applied: true })
          .mockResolvedValueOnce({ applied: false, reason: 'write-failed' })
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        fireEvent.click(await screen.findByTestId('track-menu-reverse-match'))
        await waitFor(() => expect(match).toHaveBeenCalledTimes(2))
        await new Promise((resolve) => setTimeout(resolve, 50))
        expect(window.api.removeMatchingPair).toHaveBeenCalledWith('/m/a.wav', '/m/b.wav')
        expect(window.api.addMatchingPair).not.toHaveBeenCalled()
      })

      describe('with a filter hiding the head of a block', () => {
        const SIX = ['/m/a.wav', '/m/b.wav', '/m/c.wav', '/m/d.wav', '/m/e.mp3', '/m/f.wav']
        const openFilteredBlocks = async () => {
          await openBlock(
            [
              ['r1', 'r2'],
              ['r8', 'r3'],
              ['r4', 'r6'],
            ],
            [
              entryOf('r1', '/m/a.wav'),
              entryOf('r2', '/m/b.wav'),
              separator,
              entryOf('r8', '/m/e.mp3'),
              entryOf('r3', '/m/c.wav'),
              { ...separator, linkId: 'matching-sep-2' },
              entryOf('r4', '/m/d.wav'),
              entryOf('r6', '/m/f.wav'),
            ],
            SIX,
          )
        }
        const rowOf = (title: string) =>
          screen
            .getAllByTestId('track-row')
            .findIndex((r) => r.textContent?.includes(title)) as number
        const keepOnlyWav = async () => {
          fireEvent.click(screen.getByTestId('quality-filter-trigger'))
          fireEvent.click(screen.getByTestId('quality-filter-section-format'))
          fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
          await waitFor(() => expect(titles()).toHaveLength(5))
        }

        const layout = () =>
          [
            ...document.querySelectorAll(
              '[data-testid="track-row"], [data-testid^="track-separator-"]',
            ),
          ].map((el) =>
            el.getAttribute('data-testid') === 'track-row'
              ? (['Alpha', 'Bravo', 'Charlie', 'Delta'].find((t) => el.textContent?.includes(t)) ??
                el.textContent?.slice(0, 1))
              : el.getAttribute('data-testid'),
          )

        it('keeps the break of a block whose head the filter hides, so the blocks on screen never glue together', async () => {
          await openFilteredBlocks()
          await keepOnlyWav()
          expect(layout()).toEqual([
            'Alpha',
            'Bravo',
            'track-separator-matching-sep-1',
            'Charlie',
            'track-separator-matching-sep-2',
            'Delta',
            'f',
          ])
        })

        it('keeps the blocks apart under a filter and a search together', async () => {
          await openFilteredBlocks()
          await keepOnlyWav()
          fireEvent.change(screen.getByTestId('track-search'), {
            target: { value: 'Charlie' },
          })
          await waitFor(() => expect(layout()).toEqual(['Charlie']))
          fireEvent.change(screen.getByTestId('track-search'), {
            target: { value: 'a' },
          })
          await waitFor(() =>
            expect(layout()).toEqual([
              'Alpha',
              'Bravo',
              'track-separator-matching-sep-1',
              'Charlie',
              'track-separator-matching-sep-2',
              'Delta',
              'f',
            ]),
          )
        })

        it('offers the block edits while nothing is hidden', async () => {
          await openFilteredBlocks()
          selectRows(rowOf('Charlie'))
          fireEvent.contextMenu(screen.getAllByTestId('track-row')[rowOf('Charlie')])
          await screen.findByTestId('track-menu-reverse-match')
          expect(screen.getByTestId('track-menu-leave-match')).toBeInTheDocument()
          fireEvent.keyDown(window, { key: 'Escape' })
          selectRows(rowOf('Charlie'), rowOf('Delta'))
          fireEvent.contextMenu(screen.getAllByTestId('track-row')[rowOf('Delta')])
          expect(await screen.findByTestId('track-menu-merge-match')).toBeInTheDocument()
        })

        it('offers no block edits, since the blocks on screen glue together and would write pairs that do not exist', async () => {
          await openFilteredBlocks()
          await keepOnlyWav()
          selectRows(rowOf('Charlie'))
          fireEvent.contextMenu(screen.getAllByTestId('track-row')[rowOf('Charlie')])
          await screen.findByTestId('track-menu-add-to')
          expect(screen.queryByTestId('track-menu-reverse-match')).not.toBeInTheDocument()
          expect(screen.queryByTestId('track-menu-leave-match')).not.toBeInTheDocument()
          fireEvent.keyDown(window, { key: 'Escape' })
          selectRows(rowOf('Charlie'), rowOf('Delta'))
          fireEvent.contextMenu(screen.getAllByTestId('track-row')[rowOf('Delta')])
          await screen.findByTestId('track-menu-add-to')
          expect(screen.queryByTestId('track-menu-merge-match')).not.toBeInTheDocument()
        })
      })

      it('offers neither outside Matching, where the rows are no blocks', async () => {
        await openFactory({
          dj: djReads({
            rekordbox: {
              matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['r1', 'r2']]),
            },
          }),
        })
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[1])
        await screen.findByTestId('track-menu-add-to')
        expect(screen.queryByTestId('track-menu-reverse-match')).not.toBeInTheDocument()
        expect(screen.queryByTestId('track-menu-leave-match')).not.toBeInTheDocument()
      })
    })

    it('never offers Matching as a playlist to add tracks to, since a track joins it by being paired', async () => {
      await openFactory({
        dj: djReads({
          rekordbox: {
            matching: vi.fn<ProgramReads['matching']>().mockResolvedValue([['a', 'b']]),
          },
        }),
      })
      await screen.findByTestId(`source-node-${MATCHING_ID}`)
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(await screen.findByTestId('track-menu-add-to'))
      expect(screen.getByTestId('track-menu-playlist-h')).toBeInTheDocument()
      expect(screen.queryByTestId(`track-menu-playlist-${MATCHING_ID}`)).not.toBeInTheDocument()
    })

    describe('background work', () => {
      const PATHS = ['/m/w.wav', '/m/x.wav', '/m/y.wav', '/m/z.wav']
      const ENTRIES = PATHS.map((path, i) => ({
        path,
        separator: false,
        meta: {},
        linkId: `e${i}`,
        contentId: `e${i}`,
      }))
      const collection = {
        dj: djReads({
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            tree: vi
              .fn<ProgramReads['tree']>()
              .mockResolvedValue([{ id: 'h', name: 'House', kind: 'playlist', count: 1 }]),
            trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(4),
            playlist: vi
              .fn<ProgramReads['playlist']>()
              .mockImplementation(async (id) => (id === ALL_TRACKS_ID ? ENTRIES : [ENTRIES[0]])),
          },
        }),
        cues: { trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null) },
      }

      function scrollPast(rows: HTMLElement[]): void {
        act(() => {
          for (const o of observers) {
            const seen = [...o.els].filter((el) => rows.some((r) => el === r || el.contains(r)))
            if (seen.length === 0) continue
            o.cb(
              seen.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
              o as unknown as IntersectionObserver,
            )
          }
        })
      }

      function scrollOut(rows: HTMLElement[]): void {
        act(() => {
          for (const o of observers) {
            const gone = [...o.els].filter((el) => rows.some((r) => el === r || el.contains(r)))
            if (gone.length === 0) continue
            o.cb(
              gone.map(
                (target) => ({ target, isIntersecting: false }) as IntersectionObserverEntry,
              ),
              o as unknown as IntersectionObserver,
            )
          }
        })
      }

      async function openAll(): Promise<HTMLElement[]> {
        await renderApp()
        fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
        fireEvent.click(await screen.findByTestId(`source-node-${ALL_TRACKS_ID}`))
        await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(4))
        return screen.getAllByTestId('track-row')
      }

      // A list paints its rows top to bottom and the eye follows: each row reported on screen
      // used to jump the queue on its own, so the last one reported read first and the top
      // row the user was looking at filled in last.
      it('reads the rows that come into view top to bottom', async () => {
        const many = Array.from({ length: 10 }, (_, i) => ({
          path: `/m/t${i}.wav`,
          separator: false,
          meta: {},
          linkId: `m${i}`,
          contentId: `m${i}`,
        }))
        let release: () => void = () => {}
        const gate = new Promise<void>((r) => {
          release = r
        })
        const started: string[] = []
        const read = vi.fn(async (path: string) => {
          started.push(path)
          await gate
          return {
            tags: { title: 'Song', artist: 'DJ' },
            duration: null,
            cover: null,
            foreignTags: [],
          }
        })
        setApi({
          ...collection,
          dj: djReads(collection.dj, {
            rekordbox: {
              trackCount: vi.fn<ProgramReads['trackCount']>().mockResolvedValue(10),
              playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue(many),
            },
          }),
          readMeta: read as unknown as Api['readMeta'],
          readMetaLight: read as unknown as Api['readMetaLight'],
        })
        await renderApp()
        fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
        fireEvent.click(await screen.findByTestId(`source-node-${ALL_TRACKS_ID}`))
        await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(10))
        await waitFor(() => expect(started).toHaveLength(6))
        const rows = screen.getAllByTestId('track-row')

        scrollPast([rows[7], rows[8], rows[9]])
        release()

        await waitFor(() => expect(started).toHaveLength(10))
        expect(started.slice(6, 9)).toEqual(['/m/t7.wav', '/m/t8.wav', '/m/t9.wav'])
      })

      // A library row with no art of its own takes the light read; its file's cover is read
      // only for the rows the DJ actually sees, not for every row of the collection.
      describe('file art of the rows on screen', () => {
        const lightRead = (gate?: Promise<void>) =>
          vi.fn<Api['readMetaLight']>(async () => {
            await gate
            return {
              tags: { ...emptyMetadata(), title: 'Song', artist: 'DJ' },
              duration: null,
              cover: null,
              foreignTags: [],
              partial: true,
            }
          })
        const fullRead = () =>
          vi.fn<Api['readMeta']>(async () => ({
            tags: { ...emptyMetadata(), title: 'Song', artist: 'DJ' },
            duration: null,
            cover: { thumbUrl: 'surco://cover/a.jpg', width: 600, height: 600 },
            foreignTags: [],
          }))

        it('reads the cover of the rows scrolled past and of no other', async () => {
          const readMeta = fullRead()
          setApi({ ...collection, readMetaLight: lightRead(), readMeta })
          const rows = await openAll()
          await new Promise((r) => setTimeout(r, 100))
          expect(readMeta).not.toHaveBeenCalled()

          scrollPast([rows[1]])

          await waitFor(() => expect(readMeta).toHaveBeenCalledExactlyOnceWith('/m/x.wav'))
        })

        // Without its art read a row is not known to lack one, so the filter leaves it out;
        // picking the filter is the DJ asking, so every row of the list gets its art read.
        it('reads the cover of every row once the DJ filters for the ones with none', async () => {
          const readMeta = fullRead()
          setApi({ ...collection, readMetaLight: lightRead(), readMeta })
          await openAll()
          await new Promise((r) => setTimeout(r, 100))
          expect(readMeta).not.toHaveBeenCalled()

          fireEvent.click(screen.getByTestId('quality-filter-trigger'))
          fireEvent.click(screen.getByTestId('quality-filter-section-tags'))
          fireEvent.click(screen.getByTestId('quality-filter-noCover'))

          await waitFor(() =>
            expect(readMeta.mock.calls.map(([p]) => p).sort()).toEqual([
              '/m/w.wav',
              '/m/x.wav',
              '/m/y.wav',
              '/m/z.wav',
            ]),
          )
        })

        it('reads the cover of a row already on screen once its light read lands', async () => {
          let release: () => void = () => {}
          const gate = new Promise<void>((r) => {
            release = r
          })
          const readMeta = fullRead()
          setApi({ ...collection, readMetaLight: lightRead(gate), readMeta })
          const rows = await openAll()

          scrollPast([rows[2]])
          release()

          await waitFor(() => expect(readMeta).toHaveBeenCalledExactlyOnceWith('/m/y.wav'))
        })
      })

      it('analyzes only the rows scrolled past, with auto-analyze on', async () => {
        const analyzed: string[] = []
        setApi({
          ...collection,
          getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
          readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
          spectrogram: vi.fn(async (path: string) => {
            analyzed.push(path)
            return spectrum
          }),
        })
        const rows = await openAll()
        await new Promise((r) => setTimeout(r, 400))
        expect(analyzed).toEqual([])

        scrollPast([rows[1], rows[2]])

        await waitFor(() => expect([...analyzed].sort()).toEqual(['/m/x.wav', '/m/y.wav']))
        await waitFor(() => expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull())
        expect([...analyzed].sort()).toEqual(['/m/x.wav', '/m/y.wav'])
      })

      it('leaves out a row the scroll only flies past and analyzes one the DJ stops on', async () => {
        const analyzed: string[] = []
        setApi({
          ...collection,
          getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
          readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'DJ' }),
          spectrogram: vi.fn(async (path: string) => {
            analyzed.push(path)
            return spectrum
          }),
        })
        const rows = await openAll()
        await new Promise((r) => setTimeout(r, 400))
        vi.useFakeTimers()

        scrollPast([rows[1]])
        act(() => vi.advanceTimersByTime(100))
        scrollOut([rows[1]])
        scrollPast([rows[2]])
        act(() => vi.advanceTimersByTime(400))
        act(() => vi.advanceTimersByTime(300))
        vi.useRealTimers()

        await waitFor(() => expect(analyzed).toEqual(['/m/y.wav']))
        await waitFor(() => expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull())
        expect(analyzed).toEqual(['/m/y.wav'])
      })
    })
  })

  // With a filter on, rows between the visible ones are hidden; a drop would land among them.
  it('does not reorder while a filter narrows the playlist', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav', '/m/b.wav', '/m/c.wav', '/m/d.mp3']),
      readTags: vi.fn(async (path: string) => ({ title: TITLES[path] ?? 'Delta', artist: 'DJ' })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 4 }]),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([...FACTORY_ENTRIES, linked('/m/d.mp3', 'l4')]),
        },
      }),
      startTrackDrag: vi.fn(),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(4))
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await screen.findByTestId('track-separator-s1')
    expect(screen.queryByTestId('reorder-hint')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expectNoReorderLine()
    tryToReorder()
    await screen.findByTestId('reorder-hint')
  })

  // Music is read-only: its rows offer no playlist edits and its tree no create buttons,
  // or a Music playlist id would be sent to rekordbox as an edit.
  it('offers no playlist editing while Music is the source', async () => {
    setApi({
      platform: 'darwin',
      pickFiles: vi.fn().mockResolvedValue(['/m/a.wav']),
      readTags: vi.fn(async () => ({ title: 'Alpha', artist: 'DJ' })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
        },
      }),
      loadAppleMusicPlaylists: vi.fn().mockResolvedValue([
        { persistentId: 'P1', name: 'Friday', folder: null, count: 1 },
        { persistentId: 'P2', name: 'Saturday', folder: null, count: 0 },
      ]),
      loadAppleMusicPlaylistTracks: vi
        .fn()
        .mockResolvedValue({ paths: ['/m/a.wav'], persistentIds: {}, meta: {}, missing: 0 }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-P1'))
    await waitFor(() => expect(window.api.loadAppleMusicPlaylistTracks).toHaveBeenCalled())
    await act(async () => {})
    expect(screen.queryByTestId('source-tree-new-playlist')).not.toBeInTheDocument()
    fireEvent.contextMenu((await screen.findAllByTestId('track-row'))[0])
    await screen.findByTestId('track-menu')
    expect(screen.queryByTestId('track-menu-add-to')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-remove-from')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-menu-insert-separator')).not.toBeInTheDocument()
  })

  // A drop the tree did not take ends the drag-out; its record must not outlive it and
  // keep the next Finder drag from lighting the list.
  it('forgets the dragged rows when the drop lands outside the tree', async () => {
    await openFactory({ startTrackDrag: vi.fn(), getPathForFile: vi.fn(() => '/m/a.wav') })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(screen.getByTestId('sidebar'), {
      dataTransfer: fakeDataTransfer([new File([''], 'a.wav')]),
    })
    expect(draggedRows()).toBeNull()
  })

  // Rows dragged out of the list onto a tree playlist are known from the list's own record,
  // so they are added (by their rekordbox entry) even if the OS drag brings no files back
  // into Surco's window.
  it('adds rows dragged from the list onto a playlist in the tree, with or without files', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      dj: djReads({ rekordbox: { editPlaylist: edit } }),
      startTrackDrag: vi.fn(),
    })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    const house = screen.getByTestId('source-node-h')
    fireEvent.dragOver(house, { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(house, { dataTransfer: fakeDataTransfer() })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'add',
          playlistId: 'h',
          tracks: [{ contentId: 'c-l1', paths: ['/m/a.wav'] }],
        },
        'House',
      ),
    )
  })

  // A record left behind would add these rows again on the next drop that brings no files.
  it('forgets the dragged rows once they are dropped on the tree', async () => {
    await openFactory({ startTrackDrag: vi.fn() })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(screen.getByTestId('source-node-h'), { dataTransfer: fakeDataTransfer() })
    expect(draggedRows()).toBeNull()
  })

  // A drop from Finder is files the list never dragged: they go by their paths.
  it('adds files dropped from Finder onto a playlist by their paths', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      dj: djReads({ rekordbox: { editPlaylist: edit } }),
      getPathForFile: vi.fn((f: File) => `/Volumes/Public/Music/${f.name}`),
    })
    const house = screen.getByTestId('source-node-h')
    const dt = fakeDataTransfer([new File([''], 'Gowan.wav')])
    fireEvent.dragOver(house, { dataTransfer: dt })
    fireEvent.drop(house, { dataTransfer: dt })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'add',
          playlistId: 'h',
          tracks: [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }],
        },
        'House',
      ),
    )
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'true')
  })

  it('creates a playlist named in the tree', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'create',
          parentId: 'root',
          name: 'Bolo',
          folder: false,
        },
        'Bolo',
      ),
    )
  })

  // A reorder is not files arriving; lighting the import overlay would invite a drop that
  // means something else.
  it('does not light the file-drop overlay while reordering', async () => {
    await openFactory()
    fireEvent.dragStart(rowWrapper(2), { dataTransfer: fakeDataTransfer() })
    const dt = fakeDataTransfer([new File([''], 'c.wav')])
    fireEvent.dragEnter(rowWrapper(0), { dataTransfer: dt })
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over')
  })

  // A row let go in the window outside the list (on its header, say) comes back with its
  // own files: the window's import must not take them as files arriving.
  it('does not import a row dragged from the list and dropped elsewhere in the window', async () => {
    await openFactory({ getPathForFile: vi.fn((f: File) => `/m/${f.name}`) })
    vi.mocked(window.api.expandPaths).mockClear()
    fireEvent.dragStart(rowWrapper(2), { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(screen.getByTestId('sidebar'), {
      dataTransfer: fakeDataTransfer([new File([''], 'c.wav')]),
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(window.api.expandPaths).not.toHaveBeenCalled()
    expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'true')
  })

  // The OS may hand a dragged file back resolved through a symlink (~/Music/Music links to
  // the NAS on the DJ's machine). Those are still the dragged rows: no import, no jump to
  // Tracks, and on the tree they go by their rekordbox entry.
  describe('with the dropped files spelled through the resolved music folder', () => {
    const openResolved = (over: Record<string, unknown> = {}) =>
      openFactory({
        getPathForFile: vi.fn((f: File) => `/Volumes/Public/Music/${f.name}`),
        pathAliases: vi.fn(async (paths: string[]) =>
          paths.flatMap((p) => [p, p.replace('/m/', '/Volumes/Public/Music/')]),
        ),
        ...over,
      })

    it('does not import its own rows dropped back in the window', async () => {
      await openResolved()
      vi.mocked(window.api.expandPaths).mockClear()
      fireEvent.dragStart(rowWrapper(2), { dataTransfer: fakeDataTransfer() })
      await act(async () => {})
      fireEvent.drop(screen.getByTestId('sidebar'), {
        dataTransfer: fakeDataTransfer([new File([''], 'c.wav')]),
      })
      await new Promise((r) => setTimeout(r, 0))
      expect(window.api.expandPaths).not.toHaveBeenCalled()
      expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'true')
    })

    it('adds its own rows dropped on a tree playlist by their rekordbox entry', async () => {
      const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
      await openResolved({ dj: djReads({ rekordbox: { editPlaylist: edit } }) })
      fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
      await act(async () => {})
      fireEvent.drop(screen.getByTestId('source-node-h'), {
        dataTransfer: fakeDataTransfer([new File([''], 'a.wav')]),
      })
      await waitFor(() =>
        expect(edit).toHaveBeenCalledWith(
          {
            kind: 'add',
            playlistId: 'h',
            tracks: [{ contentId: 'c-l1', paths: ['/m/a.wav'] }],
          },
          'House',
        ),
      )
    })
  })

  // Vicent's report: a row of a Music playlist let go on the list was imported, and the rail
  // jumped to Tracks to show it. A Music playlist has no order to edit, so the drop is nothing.
  it('does nothing when a row of a Music playlist is dropped back on the list', async () => {
    setApi({
      platform: 'darwin',
      readTags: vi.fn(async (path: string) => ({ title: TITLES[path], artist: 'DJ' })),
      startTrackDrag: vi.fn(),
      getPathForFile: vi.fn((f: File) => `/m/${f.name}`),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Warm up', count: 2 }]),
      loadAppleMusicPlaylistTracks: vi.fn<Api['loadAppleMusicPlaylistTracks']>().mockResolvedValue({
        paths: ['/m/a.wav', '/m/b.wav'],
        persistentIds: {},
        meta: {},
        missing: 0,
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    vi.mocked(window.api.expandPaths).mockClear()

    fireEvent.dragStart(rowWrapper(1), { dataTransfer: fakeDataTransfer() })
    expect(window.api.startTrackDrag).toHaveBeenCalledWith(['/m/b.wav'], undefined)
    const back = fakeDataTransfer([new File([''], 'b.wav')])
    fireEvent.dragOver(rowWrapper(0), { dataTransfer: back, clientY: -1 })
    fireEvent.drop(rowWrapper(0), { dataTransfer: back })
    await new Promise((r) => setTimeout(r, 0))

    expect(window.api.expandPaths).not.toHaveBeenCalled()
    expect(screen.getByTestId('source-rail-appleMusic')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByTestId('track-row')).toHaveLength(2)
  })

  // The record of a drag-out can outlive it; Finder files let go in the window are still an
  // import, not rows of that earlier drag.
  it('still imports Finder files dropped in the window after a drag-out', async () => {
    await openFactory({ getPathForFile: vi.fn((f: File) => `/Finder/${f.name}`) })
    vi.mocked(window.api.expandPaths).mockClear()
    fireEvent.dragStart(rowWrapper(2), { dataTransfer: fakeDataTransfer() })
    fireEvent.drop(screen.getByTestId('sidebar'), {
      dataTransfer: fakeDataTransfer([new File([''], 'new.wav')]),
    })
    await waitFor(() =>
      expect(window.api.expandPaths).toHaveBeenCalledWith(['/Finder/new.wav'], true),
    )
  })

  // Rows dragged out of the list toward a playlist in the tree are already in the list;
  // lighting the column as an import target would offer to add them a second time.
  it('does not light the list as an import target while its rows are dragged to the tree', async () => {
    await openFactory({ startTrackDrag: vi.fn() })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    const files = fakeDataTransfer([new File([''], 'a.wav')])
    fireEvent.dragEnter(screen.getByTestId('source-node-h'), { dataTransfer: files })
    fireEvent.dragOver(screen.getByTestId('source-node-h'), { dataTransfer: files })
    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over')
  })

  // With a search typed, rows between the visible ones are hidden; a drop would land among
  // them, so no reordering until the search is cleared.
  it('does not reorder while a search narrows the playlist', async () => {
    await openFactory()
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'Alpha' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expectNoReorderLine()
  })

  // A track the playlist holds twice is one row: dragging it moves both of its rekordbox
  // rows, or the one left behind would decide where the row is shown after the re-read.
  it('moves every row of a track the playlist holds twice', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      dj: djReads({
        rekordbox: {
          editPlaylist: edit,
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([...FACTORY_ENTRIES, linked('/m/a.wav', 'l4')]),
        },
      }),
    })
    const dt = fakeDataTransfer()
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: dt })
    fireEvent.dragOver(rowWrapper(2), { dataTransfer: dt, clientY: 1 })
    fireEvent.drop(rowWrapper(2), { dataTransfer: dt })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'move',
          playlistId: 'f',
          linkIds: ['l1', 'l4'],
          beforeLinkId: null,
        },
        'Factory',
      ),
    )
  })

  // The row stands for every row the track has in the playlist. Traktor deletes only the
  // rows it is named, so naming the first left the track in the playlist, shown again on
  // the re-read as if the remove had failed.
  it('removes every row of a track the playlist holds twice', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      dj: djReads({
        rekordbox: {
          editPlaylist: edit,
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([...FACTORY_ENTRIES, linked('/m/a.wav', 'l4')]),
        },
      }),
    })
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('track-menu-remove-from'))
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'remove', playlistId: 'f', linkIds: ['l1', 'l4'] },
        'Factory',
      ),
    )
  })

  // The record of a drag-out can outlive it (an OS drag that ended elsewhere tells this
  // window nothing). A Finder drop that finds it must still add its own files.
  it('adds the dropped Finder files, not rows left from an earlier drag-out', async () => {
    const edit = vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true })
    await openFactory({
      dj: djReads({ rekordbox: { editPlaylist: edit } }),
      startTrackDrag: vi.fn(),
      getPathForFile: vi.fn((f: File) => `/Volumes/Public/Music/${f.name}`),
    })
    fireEvent.dragStart(rowWrapper(0), { dataTransfer: fakeDataTransfer() })
    const house = screen.getByTestId('source-node-h')
    const dt = fakeDataTransfer([new File([''], 'Gowan.wav')])
    fireEvent.dragOver(house, { dataTransfer: dt })
    fireEvent.drop(house, { dataTransfer: dt })
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        {
          kind: 'add',
          playlistId: 'h',
          tracks: [{ paths: ['/Volumes/Public/Music/Gowan.wav'] }],
        },
        'House',
      ),
    )
  })
})

describe('App track list label', () => {
  // The left list is a stable reference: it shows what each file was when imported and never
  // moves while the metadata form on the right is edited. Otherwise the row renames itself
  // under the cursor as you type a title — which is disorienting on a big crate.
  it('keeps the row label fixed while the title is edited in the form', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    const row = screen.getByTestId('track-row')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })

    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
    expect(within(row).getByText('Imported Title')).toBeInTheDocument()
    expect(within(row).queryByText('Hand Typed')).not.toBeInTheDocument()
  })
})

describe('App import skeleton', () => {
  // "Add files" used to pass the picker's result straight to the list, so a folder picked
  // there (macOS lets the dialog select folders) imported nothing while the same folder
  // dropped in worked. Routing the picked paths through the same expand the drop uses makes
  // the button and the drop behave alike — a picked folder walks to its audio files.
  it('expands a folder chosen from the file picker into its audio files', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/crate']),
      expandPaths: vi.fn(async () => ['/music/crate/a.wav', '/music/crate/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(window.api.expandPaths).toHaveBeenCalledWith(['/music/crate'], true)
  })

  // Reading tags/duration/cover up front used to block the whole drop behind the slowest
  // file: a cloud or network folder showed an empty list for seconds and looked broken
  // even though the import was running. The rows must appear the instant they're dropped,
  // parsed from the filename, with a loading placeholder until each file's metadata lands.
  it('shows dropped rows immediately while their metadata is still loading', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: 'Loaded', artist: 'Artist' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))

    // Rows render before any tag read resolves, each carrying a loading placeholder.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getAllByTestId('track-loading')).toHaveLength(2)

    // Once the reads land, the placeholders clear.
    releaseTags()
    await waitFor(() => expect(screen.queryAllByTestId('track-loading')).toHaveLength(0))
  })

  // A big drop reads tags for ages; an opaque animated bar gives no sense of how far along
  // it is. A "done/total" counter beside Add files turns the wait into visible progress and
  // clears once every file's metadata has landed.
  it('counts metadata-read progress beside Add files until the drop finishes', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: 'T', artist: 'A' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Reads are still gated → none of the two have resolved yet.
    expect(screen.getByTestId('sweep-icon-import')).toBeInTheDocument()
    expect(screen.getByTestId('sweeps-percent')).toHaveTextContent(
      new Intl.NumberFormat(i18n.language, { style: 'percent' }).format(0),
    )
    // Once both land, the counter clears.
    await act(async () => {
      releaseTags()
    })
    await waitFor(() => expect(screen.queryByTestId('sweep-icon-import')).toBeNull())
  })

  // The native file dialog can stay open for a long time; a file that arrives through
  // the OS meanwhile ("Open with Surco") must still dedupe against the picker's result —
  // the dedupe has to read the live list, not the snapshot from when the dialog opened.
  it('dedupes a file that arrived while the picker dialog was open', async () => {
    let openFiles: (paths: string[]) => Promise<void> = () => Promise.resolve()
    let resolvePick: (paths: string[]) => void = () => {}
    setApi({
      pickFiles: vi.fn(
        () =>
          new Promise<string[]>((res) => {
            resolvePick = res
          }),
      ),
      onOpenFiles: (cb: (paths: string[]) => Promise<void>) => {
        openFiles = cb
        return () => {}
      },
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))

    await act(async () => {
      await openFiles(['/music/a.wav'])
    })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    await act(async () => {
      resolvePick(['/music/a.wav'])
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
  })

  // Re-dragging a folder used to be a silent no-op; now the skipped duplicates are
  // reported so the import doesn't look broken when nothing new appears.
  it('tells the user when re-imported files were already in the list', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows).toHaveLength(2)

    // Importing the same files again adds no rows and surfaces a notice.
    fireEvent.click(screen.getByTestId('add-files'))
    expect(await screen.findByTestId('app-notice')).toBeInTheDocument()
    expect(screen.getAllByTestId('track-row')).toHaveLength(2)
  })

  it('tells the user when an opened folder holds no audio at all, instead of doing nothing visible', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/no-audio']),
      expandPaths: vi.fn().mockResolvedValue([]),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      i18n.t('notices.noAudioFound'),
    )
  })

  // The rows are editable from the instant they land, so a slow read (cloud folder) can
  // resolve after the user already typed into the form. The read fills what it learned,
  // but a field the user touched meanwhile must keep the user's value.
  it('keeps an edit typed while the file was still being read', async () => {
    let releaseTags: () => void = () => {}
    const tagsGate = new Promise<void>((res) => {
      releaseTags = res
    })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn(async () => {
        await tagsGate
        return { title: '', artist: 'Tagged Artist' }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    releaseTags()

    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('Tagged Artist'),
    )
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Hand Typed')
  })
})

describe('App error surfacing', () => {
  // If the OS trash call fails, the row
  // must stay AND the failure must be said out loud — a silent catch reads as success
  // and the user walks away believing the file is gone.
  it('surfaces a failed trash instead of pretending the file was deleted', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      trashFile: vi.fn().mockRejectedValue(new Error('locked')),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-trash'))

    expect(await screen.findByTestId('app-error')).toBeInTheDocument()
    expect(screen.getByTestId('track-row')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('app-error-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('app-error')).toBeNull())
  })

  // A failed settings read leaves the whole session on defaults with onboarding
  // suppressed; it must say so rather than looking like a fresh, working install.
  it('surfaces a settings load failure', async () => {
    setApi({ getSettings: vi.fn().mockRejectedValue(new Error('corrupt')) })
    await renderApp()
    expect(await screen.findByTestId('app-error')).toBeInTheDocument()
  })

  // Anything IPC-shaped that rejects outside a catch (shell calls, fire-and-forget
  // writes) must surface instead of vanishing into the devtools console.
  it('surfaces unhandled promise rejections', async () => {
    await renderApp()
    const event = new Event('unhandledrejection') as unknown as PromiseRejectionEvent
    Object.defineProperty(event, 'reason', { value: new Error('boom') })
    act(() => {
      window.dispatchEvent(event)
    })
    expect(await screen.findByTestId('app-error')).toHaveTextContent('boom')
  })
})

describe('App loudness help overlay', () => {
  // The help dialog must gate the global shortcuts like every other modal. It used to
  // live inside the keyed Editor without setting overlayOpen: pressing the next-track
  // key with it open moved the selection, remounted the Editor, and silently destroyed
  // the dialog under the user.
  it('keeps track shortcuts gated while the loudness help dialog is open', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(
        settings({
          showLoudness: true,
          editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
            s.id === 'normalize' ? { ...s, open: true } : s,
          ),
        }),
      ),
      loudness: vi.fn().mockResolvedValue({
        integratedLufs: -12,
        truePeakDb: -1.5,
        lra: 8,
        channelBalanceDb: 0.5,
        dcOffset: 0.0001,
        crestDb: 16,
        noiseFloorDb: -55,
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('loudness-help-toggle'))
    // The help overlay is a lazy chunk, so it mounts a microtask after the click.
    expect(await screen.findByTestId('loudness-help')).toHaveAccessibleName()

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })
    expect(screen.getByTestId('loudness-help')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('loudness-help')).toBeNull()
  })
})

describe('App new-tracks offer', () => {
  // The toast holds its countdown while the pointer rests on it, so the user can still
  // reach Load. Expiring declines the files for good, so the offer must not age out
  // underneath the cursor on a clock of its own.
  it('keeps the offer up while the pointer rests on it', async () => {
    let fire: (root: string, files: string[]) => void = () => {}
    setApi({
      onFoldersChanged: vi.fn<Api['onFoldersChanged']>((cb) => {
        fire = cb
        return () => {}
      }),
    })
    await renderApp()
    await addTwoTracks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      act(() => fire('/music', ['/music/a.wav', '/music/b.wav', '/music/c.wav']))
      fireEvent.pointerEnter(await screen.findByTestId('new-tracks'))
      act(() => vi.advanceTimersByTime(NEW_TRACKS_PROMPT_TIMEOUT_MS * 2))
      expect(screen.getByTestId('new-tracks')).not.toHaveAttribute('aria-hidden')
      fireEvent.click(screen.getByTestId('new-tracks-action'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    } finally {
      vi.useRealTimers()
    }
  })

  // The prompt must not demand an answer: left alone it times out, and timing out counts
  // as declining, otherwise the next poll would raise it again a minute later.
  it('expires the offer on its own and does not re-offer the files', async () => {
    let fire: (root: string, files: string[]) => void = () => {}
    setApi({
      onFoldersChanged: vi.fn<Api['onFoldersChanged']>((cb) => {
        fire = cb
        return () => {}
      }),
    })
    await renderApp()
    await addTwoTracks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const files = ['/music/a.wav', '/music/b.wav', '/music/c.wav']
      act(() => fire('/music', files))
      await screen.findByTestId('new-tracks')
      act(() => vi.advanceTimersByTime(NEW_TRACKS_PROMPT_TIMEOUT_MS + 1000))
      await waitFor(() => expect(screen.queryByTestId('new-tracks')).toBeNull())
      act(() => fire('/music', [...files, '/music/d.wav']))
      expect(await screen.findByTestId('new-tracks')).toHaveTextContent('1 new track in')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('App list order while editing', () => {
  // Sorted by artist, correcting the selected track's artist moved its row on every key,
  // so the row the user was working on jumped away mid-word. The order holds while the
  // track stays selected and catches up when the user moves on.
  it('holds the sorted order while the selected track is edited and re-sorts on the next pick', async () => {
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'First', artist: 'Alpha' },
      '/music/b.wav': { title: 'Second', artist: 'Bravo' },
    }
    setApi({
      pickFiles: vi.fn().mockResolvedValue(Object.keys(tags)),
      readMeta: vi.fn(async (path: string) => ({ tags: tags[path], duration: 180, cover: null })),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    const labels = () => screen.getAllByTestId('track-row').map((r) => r.textContent ?? '')
    await waitFor(() => expect(labels()[0]).toContain('First'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.change(await screen.findByTestId('field-artist'), { target: { value: 'Zulu' } })
    await waitFor(() => expect(labels()[0]).toContain('Zulu'))
    expect(labels()[0]).toContain('First')
    fireEvent.pointerEnter(screen.getByTestId('track-list-scroll'))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    // Still under the pointer: a re-sort now would slide the row the user just clicked, and
    // the second click of a double-click would play the row that slid into its place.
    expect(labels()[0]).toContain('First')
    fireEvent.pointerLeave(screen.getByTestId('track-list-scroll'))
    await waitFor(() => expect(labels()[0]).toContain('Second'))
  })
})

describe('App per-track format pick', () => {
  const openFormatMenu = async (): Promise<void> => {
    const toggle = await screen.findByTestId('process-format-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
  }
  // djotas lost his loudness pick the same way: a format chosen for one track came back
  // as the Settings default after a glance at another, and ⌘⏎ then converted it wrong.
  it('keeps the format picked for a track after visiting another one', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }) })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    await openFormatMenu()
    fireEvent.click(screen.getByTestId('process-format-flac'))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true'),
    )
    await openFormatMenu()
    expect(screen.getByTestId('process-format-flac')).toHaveAttribute('aria-checked', 'true')
  })

  it('keeps the destination picked for a track after visiting another one', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }) })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    await openFormatMenu()
    fireEvent.click(screen.getByTestId('process-destination-beside'))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true'),
    )
    await openFormatMenu()
    expect(screen.getByTestId('process-destination-beside')).toHaveAttribute('aria-checked', 'true')
  })

  // A user with Keep MP3 on and "Next to the original" as the default only wanted to retag
  // one MP3 in place. The rule left the file untouched and the menu had no way to say
  // "this one, rewrite the original", so the only path was changing Settings for good.
  it('rewrites one MP3 in place when Edit the original is picked in the menu', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/music/a.mp3', inPlace: true })
    setApi({
      getSettings: vi.fn().mockResolvedValue(
        settings({
          outputFormat: 'aiff',
          keepMp3Sources: true,
          convertBesideOriginal: true,
          overwriteOriginal: false,
        }),
      ),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    fireEvent.click((await screen.findAllByTestId('track-row'))[0])
    await openFormatMenu()
    fireEvent.click(screen.getByTestId('process-destination-overwrite'))
    fireEvent.click(screen.getByTestId('convert-update-anyway'))
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    const [job] = processTrack.mock.calls[0]
    expect(job.format).toBe('mp3')
    expect(job.overwriteOriginal).toBe(true)
  })

  it('rewrites the original once from the command palette, asking first and keeping the menu pick', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/music/a.mp3', inPlace: true })
    setApi({
      getSettings: vi.fn().mockResolvedValue(
        settings({
          outputFormat: 'aiff',
          keepMp3Sources: true,
          convertBesideOriginal: true,
          overwriteOriginal: false,
        }),
      ),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    fireEvent.click((await screen.findAllByTestId('track-row'))[0])
    const toggle = await screen.findByTestId('process-format-toggle')
    await waitFor(() => expect(toggle).toBeEnabled())
    runMenu('convert-edit-original')
    expect(processTrack).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    const [job] = processTrack.mock.calls[0]
    expect(job.format).toBe('mp3')
    expect(job.overwriteOriginal).toBe(true)
    fireEvent.click(await screen.findByTestId('done-more'))
    expect(screen.getByTestId('process-destination-beside')).toHaveAttribute('aria-checked', 'true')
  })

  it('says the conversion went through and only Apple Music failed', async () => {
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/music/a.aiff',
      inPlace: false,
      appleMusicFailed: true,
    })
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      processTrack,
    })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    fireEvent.click(await screen.findByTestId('process-btn'))
    expect(await screen.findByTestId('music-after-convert')).toHaveTextContent('Apple Music')
    expect(screen.queryByTestId('app-error')).not.toBeInTheDocument()
  })

  // The old entry stays when its playlists, play count and rating could not move to the new
  // one. Without saying why, the DJ sees two copies in Music and deletes the wrong one.
  it('says both copies stayed in Apple Music when the old one could not hand over its playlists', async () => {
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/music/a.aiff',
      inPlace: false,
      oldMusicCopyKept: 'carry',
    })
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      processTrack,
    })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    fireEvent.click(await screen.findByTestId('process-btn'))
    expect(await screen.findByTestId('old-copy-error')).toHaveTextContent(
      i18n.t('editor.removeOldCopyCarry'),
    )
  })

  // Widening to several tracks and back to one kept "Convert to FLAC" on the button while
  // the convert itself fell back to the Settings format.
  it('converts in the picked format after the selection widens and narrows back', async () => {
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/music/a.flac',
    } as Awaited<ReturnType<Api['processTrack']>>)
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      processTrack,
    })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    await openFormatMenu()
    fireEvent.click(screen.getByTestId('process-format-flac'))
    fireEvent.click(screen.getAllByTestId('track-row')[1], { shiftKey: true })
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'false'),
    )
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('FLAC')
    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0].format).toBe('flac')
  })

  // The pick belongs to that track only; the next one still starts from Settings.
  it('starts another track from the Settings format', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }) })
    await renderApp()
    const [a] = await addTwoTracks()
    fireEvent.click(a)
    await openFormatMenu()
    fireEvent.click(screen.getByTestId('process-format-flac'))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    await openFormatMenu()
    expect(screen.getByTestId('process-format-flac')).toHaveAttribute('aria-checked', 'false')
  })
})

describe('App maximized section', () => {
  // Escape while a section fills the window must ONLY restore the section. The
  // global Escape (clear the selection) used to fire too, so the overlay closed
  // AND the track deselected — the editor vanished mid-review.
  it('restores the section on Escape without dropping the selection', async () => {
    await renderApp()
    const [row] = await addTwoTracks()
    fireEvent.click(row)
    const trim = await screen.findByTestId('editor-trim')
    fireEvent.click(within(trim).getByTestId('section-maximize'))
    await screen.findByTestId('section-maximized-overlay')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('section-maximized-overlay')).toBeNull()
    expect(screen.getByTestId('editor-trim')).toBeInTheDocument()
  })

  // A dialog opened over the maximized section owns Escape: the press that dismisses the
  // palette must leave the section the user was working in maximized.
  it('closes only the palette when Escape is pressed over a maximized section', async () => {
    await renderApp()
    const [row] = await addTwoTracks()
    fireEvent.click(row)
    const trim = await screen.findByTestId('editor-trim')
    fireEvent.click(within(trim).getByTestId('section-maximize'))
    await screen.findByTestId('section-maximized-overlay')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(await screen.findByTestId('palette-input')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette-input')).toBeNull())
    expect(screen.getByTestId('section-maximized-overlay')).toBeInTheDocument()
  })
})

describe('App track removal', () => {
  // Removed tracks must not pin their probe results in the session-long query cache:
  // spectrogram images are the heaviest objects in the app, and a long session of
  // add/remove would otherwise retain every one of them until quit.
  it('evicts a removed track’s cached probes', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    const client = await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    client.setQueryData(['spectrogram', '/music/a.wav'], spectrum)
    client.setQueryData(['bpm', '/music/a.wav'], 128)

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))

    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    expect(client.getQueryData(['spectrogram', '/music/a.wav'])).toBeUndefined()
    expect(client.getQueryData(['bpm', '/music/a.wav'])).toBeUndefined()
  })
})

describe('App multi-select field edit', () => {
  it('gives every track its own artist back on undo after one value was written over all of them', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: 'T',
        artist: { '/music/a.wav': 'Alpha', '/music/b.wav': 'Bravo', '/music/c.wav': 'Charlie' }[
          path
        ],
      })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(rows[2], { metaKey: true })

    const artist = await screen.findByTestId('field-artist')
    fireEvent.change(artist, { target: { value: 'Everyone' } })
    fireEvent.blur(artist)
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    for (const [index, expected] of ['Alpha', 'Bravo', 'Charlie'].entries()) {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue(expected))
    }
  })
})

describe('App multi-select numbering', () => {
  const selectSortedByArtist = async () => {
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ visibleFields: ['title', 'artist', 'trackNumber'] })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: path.slice(-5, -4),
        artist: { '/music/a.wav': 'Charlie', '/music/b.wav': 'Alpha', '/music/c.wav': 'Bravo' }[
          path
        ],
      })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-artist'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')[0]).toHaveTextContent('Alpha'))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(rows[2], { metaKey: true })
  }
  const expectNumberedTopToBottom = async () => {
    for (const [index, expected] of ['1', '2', '3'].entries()) {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() => expect(screen.getByTestId('field-trackNumber')).toHaveValue(expected))
    }
  }

  // The library keeps files in the order they were added; numbering follows the rows the
  // user sees, so a list sorted by artist must number by that sort, not by import.
  it('numbers the selected tracks in the order the sorted list shows them', async () => {
    await selectSortedByArtist()

    fireEvent.click(await screen.findByTestId('number-tracks-btn'))

    expect(
      await screen.findByText(i18n.t('notices.numberedTracks', { count: 3 })),
    ).toBeInTheDocument()
    await expectNumberedTopToBottom()
  })

  // The ⌘K command and the editor button are the same action; the command once numbered
  // by import order, so on a sorted list the two disagreed about which track is first.
  it('numbers from the command in the order the sorted list shows them, like the button', async () => {
    await selectSortedByArtist()

    runMenu('number-tracks')

    expect(
      await screen.findByText(i18n.t('notices.numberedTracks', { count: 3 })),
    ).toBeInTheDocument()
    await expectNumberedTopToBottom()
  })
})

describe('App multi-select removal', () => {
  // The right-click row stays selected when it's already part of the selection, so the
  // menu's list actions follow what's highlighted. "Remove from Surco" on one of several
  // selected rows must drop the whole selection, not just the clicked row, at once: the
  // toast's Undo brings the rows back with their staged edits.
  it('removes every selected track, not just the right-clicked one', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.contextMenu(rows[1])
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // Once the range is really gone, ⌫ still walks on: the row after it takes the selection
  // and the focus, so the next arrow or ⌫ continues from there.
  it('hands selection and focus to the row after the range once it is removed', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowDown', shiftKey: true })
    fireEvent.keyDown(rows[1], { key: 'Backspace' })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(rows[2]).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(rows[2]).toHaveFocus())
  })

  // Same selection rule for the destructive action: "Move to Trash" sends every selected
  // file to the OS trash, not just the row under the cursor.
  it('trashes every selected file from the right-click menu', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      trashFile,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.contextMenu(rows[1])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    expect(trashFile.mock.calls.map((c) => c[0]).sort()).toEqual(['/music/a.wav', '/music/b.wav'])
  })

  // A search narrows what the user sees; the selection must narrow with it. Trashing "the
  // selection" after searching used to also send the selected rows the search was hiding to
  // the OS trash, files the user could not see when they confirmed.
  it('trashes only the selected rows the search still shows', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      pickFiles: vi
        .fn()
        .mockResolvedValue(['/music/kick.wav', '/music/snare.wav', '/music/kick2.wav']),
      trashFile,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(rows[2], { metaKey: true })

    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'kick' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))

    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    expect(trashFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/music/kick.wav',
      '/music/kick2.wav',
    ])
  })

  // A search typed in a DJ program followed the user into Tracks, where it hid rows they never
  // searched for there (22/11). Tracks comes back with its own search, empty here, and the
  // program gets its search back on the way back.
  it('leaves a search typed in a program out of Tracks', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/kick.wav', '/music/snare.wav']),
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 1 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/scratchism.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'scratchism' } })

    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(screen.getByTestId('track-search')).toHaveValue('')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('source-rail-engine'))
    expect(screen.getByTestId('track-search')).toHaveValue('scratchism')
  })

  // Tracks gets its search back when the user returns to it, so it can show fewer rows than
  // the selection made there. An action on the selection must never reach a row the user
  // cannot see: the snare, hidden by the search, must stay out of the OS trash.
  it('trashes only the selected rows the search shows after coming back from another source', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      pickFiles: vi
        .fn()
        .mockResolvedValue(['/music/kick.wav', '/music/snare.wav', '/music/kick2.wav']),
      trashFile,
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 1 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/kick-other.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(rows[2], { metaKey: true })
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'kick' } })

    fireEvent.click(await screen.findByTestId('source-rail-engine'))
    fireEvent.click(await screen.findByTestId('source-node-7'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('source-rail-tracks'))
    expect(screen.getByTestId('track-search')).toHaveValue('kick')

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))

    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    expect(trashFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/music/kick.wav',
      '/music/kick2.wav',
    ])
  })

  // Same rule for a filter: narrowing to MP3 and trashing the selection must not take the
  // selected WAV the filter is hiding.
  it('trashes only the selected rows the format filter still shows', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.mp3', '/music/b.wav', '/music/c.mp3']),
      trashFile,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(rows[2], { metaKey: true })

    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))

    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    expect(trashFile.mock.calls.map((c) => c[0]).sort()).toEqual(['/music/a.mp3', '/music/c.mp3'])
  })

  // The toolbar trash mirrors what's on screen, not the selection: with no filter every row is
  // visible, so it empties the whole list even when only some rows are multi-selected. Removing
  // just a few rows is the right-click "Remove from Surco"; this button is not selection-scoped.
  it('empties every visible row from the toolbar trash, ignoring the selection', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    runMenu('remove-all')
    // The two-row selection doesn't narrow it: all three visible rows go.
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
  })

  // The swipe is the row's own gesture, the way Mail's swipe deletes one message: it takes
  // the swiped row and nothing else, and it never stops to ask. Vicent 24/09: "no debe salir
  // el modal". The selection-wide removal stays on ⌫ and the menu.
  it('removes only the swiped row, without asking, even inside a selection', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })

    fireEvent.wheel(rows[0].parentElement as HTMLElement, { deltaX: 400 })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.queryByTestId('confirm-ok')).toBeNull()
  })

  it('removes a lone swiped row without asking', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')

    fireEvent.wheel(rows[0].parentElement as HTMLElement, { deltaX: 400 })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.queryByTestId('confirm-ok')).toBeNull()
  })
})

describe('App background measuring', () => {
  afterEach(resetGridChecks)

  // "Rejilla mal" decodes each rekordbox row against its grid. It belongs to the analysis like
  // the rest: with Analyze on import it runs by itself, without the user having to know that
  // picking the filter is what starts it.
  function openRekordbox(autoAnalyze: boolean) {
    const measureGrid = vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 2 }]),
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
            { path: '/m/a.wav', separator: false, meta: {}, contentId: '41' },
            { path: '/m/b.wav', separator: false, meta: {}, contentId: '42' },
          ]),
        },
      }),
      cues: {
        trackCues: measureGrid,
      },
    })
    return measureGrid
  }

  async function openFactory(): Promise<void> {
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  it('measures the grids by itself when every import is analysed', async () => {
    const measureGrid = openRekordbox(true)
    await openFactory()
    await waitFor(() => expect(measureGrid).toHaveBeenCalledTimes(2))
  })

  // Without that setting the analysis waits for the button, and the grids with it. "Everything
  // is already analysed" would otherwise keep the button off while they were never measured.
  it('measures the grids with the Analyze button otherwise, which stays on until they are', async () => {
    const measureGrid = openRekordbox(false)
    await openFactory()
    await act(async () => {})
    expect(measureGrid).not.toHaveBeenCalled()
    const analyze = screen.getByTestId('analyze-quality')
    expect(analyze).not.toBeDisabled()
    fireEvent.click(analyze)
    await waitFor(() => expect(measureGrid).toHaveBeenCalledTimes(2))
  })

  it('does not call everything analysed while the grids are still being measured', async () => {
    const measureGrid = openRekordbox(false)
    measureGrid.mockImplementation(() => new Promise(() => {}))
    await openFactory()
    fireEvent.click(screen.getByTestId('analyze-quality'))
    await waitFor(() => expect(screen.queryByTestId('sweep-icon-analyze')).toBeNull())
    expect(measureGrid).toHaveBeenCalled()
    expect(screen.getByTestId('analyze-quality')).not.toBeDisabled()
    expect(screen.getByTestId('analyze-quality')).not.toHaveAccessibleName(
      i18n.t('header.allAnalyzed'),
    )
  })
})

describe('App row playback', () => {
  // A few picked out of a long list, to look at on their own before converting them.
  it('narrows the list to the selected tracks from the filter', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[2], { metaKey: true })
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-list'))
    expect(screen.getByTestId('quality-filter-selected')).toHaveTextContent(/2$/)
    fireEvent.click(screen.getByTestId('quality-filter-selected'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  // 700 tracks gone through over several days: what was heard is marked, and the filter
  // keeps what is still to hear.
  it('marks a track heard once it has played a few seconds, and filters it out of the unplayed', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    await screen.findByTestId('player')
    const audio = document.querySelector('audio') as HTMLAudioElement
    for (let t = 0; t <= 6; t += 0.25) {
      audio.currentTime = t
      fireEvent.timeUpdate(audio)
    }
    const marked = await screen.findAllByTestId('track-played')
    expect(marked).toHaveLength(1)
    expect(screen.getAllByTestId('track-row')[1]).toContainElement(marked[0])

    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-list'))
    fireEvent.click(screen.getByTestId('quality-filter-unplayed'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.queryByTestId('track-played')).toBeNull()
  })

  // Double-clicking a track is the quick "play this" gesture: it opens the floating
  // player straight on that row, without reaching for Space or the player toggle.
  it('opens the player on the double-clicked track', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(screen.queryByTestId('player')).toBeNull()
    // A real double-click selects the row first (the click) then fires dblclick.
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    expect(await screen.findByTestId('player')).toBeInTheDocument()
  })

  // Double-click is a play/stop toggle on the row: a second double-click on the track
  // that's already playing stops it and closes the player.
  it('stops playback when the playing track is double-clicked again', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    expect(await screen.findByTestId('player')).toBeInTheDocument()
    fireEvent.click(rows[1])
    fireEvent.doubleClick(rows[1])
    await waitFor(() => expect(screen.queryByTestId('player')).toBeNull())
  })

  // The card sits in the list column of the tab it was started from; on another tab it
  // kept sounding a track that tab does not show, with no row to say where it came from.
  it('closes the player when another tab is picked, so a track never keeps playing from a tab that does not show it', async () => {
    setApi({
      platform: 'darwin',
      readTags: vi.fn(async () => ({ title: 'Bravo', artist: 'DJ' })),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
        },
      }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: 1 }]),
      loadAppleMusicPlaylistTracks: vi.fn<Api['loadAppleMusicPlaylistTracks']>().mockResolvedValue({
        paths: ['/m/b.wav'],
        persistentIds: {},
        meta: {},
        missing: 0,
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    const [row] = await screen.findAllByTestId('track-row')
    fireEvent.click(row)
    fireEvent.doubleClick(row)
    await screen.findByTestId('player')

    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-f')
    await waitFor(() => expect(screen.queryByTestId('player')).toBeNull())

    fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
    await screen.findAllByTestId('track-row')
    await act(async () => {})
    expect(screen.queryByTestId('player')).toBeNull()
  })
})

describe('App track position', () => {
  // Auditioning a crate one by one, the DJ wants to see how far along they are. The
  // x/total counter sits beside the (collapsed) filter dropdown and stays visible even
  // with the whole library in view — that's the indicator the user relies on.
  it('shows the selected position as an x/total counter beside the filter', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    expect(screen.getByTestId('track-position')).toHaveTextContent('2/2')
  })

  // Narrowing the view (a filter or, here, a search) can drop the selected track out of
  // sight, which used to hide the counter entirely. It must stay visible as "‒/total" so
  // the DJ still sees how many tracks the current view holds to go through.
  it('keeps the counter visible as ‒/total when the selection is filtered out of the view', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    expect(screen.getByTestId('track-position')).toHaveTextContent('1/2')
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'b' } })
    await waitFor(() => expect(screen.getByTestId('track-position')).toHaveTextContent('‒/1'))
  })
})

describe('App selection range', () => {
  // A Shift-click extends the range over the rows the user sees. When a filter (here a
  // search) hides a track that sits between the two clicks in import order, that hidden
  // track must NOT be swept into the selection — the range follows the visible order.
  it('ranges a Shift-click over the visible order, skipping filtered-out tracks', async () => {
    setApi({
      pickFiles: vi
        .fn()
        .mockResolvedValue(['/music/kick.wav', '/music/snare.wav', '/music/kick2.wav']),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    // Hide the middle track (snare); only kick and kick2 stay visible.
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'kick' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const visible = screen.getAllByTestId('track-row')
    fireEvent.click(visible[0])
    fireEvent.click(visible[1], { shiftKey: true })
    // Clear the filter and confirm the hidden snare was never selected: exactly the two
    // visible rows are pressed, not the three the import-order range would have taken.
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: '' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const pressed = screen
      .getAllByTestId('track-row')
      .filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(pressed).toHaveLength(2)
  })
})

describe('App start over', () => {
  // A bad match or stray edits can leave a track worse than when it landed; the
  // right-click "Start over" rebuilds the row from the file alone — re-reading its
  // tags and dropping every edit — exactly as if it had just been dropped again.
  it('re-reads the file and discards edits when starting over', async () => {
    const readTags = vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' })
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']), readTags })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Hand Typed' } })
    const reads = readTags.mock.calls.length

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-startover'))

    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title'),
    )
    expect(readTags.mock.calls.length).toBe(reads + 1)
  })

  // The other half of the reset: the Discogs box must re-seed from the fresh read so
  // the search can start over too, not keep whatever query the user had typed into it.
  it('re-seeds the Discogs search box so the search can start again', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'scribbles' } })

    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-startover'))

    await waitFor(() =>
      expect((screen.getByTestId('discogs-query') as HTMLInputElement).value).not.toBe('scribbles'),
    )
  })
})

describe('App regenerate filename', () => {
  // The fast path: one click on Regenerate rewrites the output name from the Settings
  // naming pattern, no modal. This is the wiring that lets a user retag and rename in two
  // clicks instead of opening the builder for every track.
  it('rewrites the output name from the Settings pattern in one click', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/raw 01.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Bumping', artist: 'Di Carlo' }),
      getSettings: vi.fn().mockResolvedValue(settings({ filenameFormat: '{artist} - {title}' })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('regenerate-output-name'))
    await waitFor(() => expect(screen.getByTestId('output-name')).toHaveValue('Di Carlo - Bumping'))
  })

  // The copy button hands the same Settings-pattern name to the OS clipboard so the user
  // can paste the track straight into Google or Soulseek to hunt for a better rip.
  it('copies the Settings-pattern file name to the clipboard in one click', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/raw 01.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Bumping', artist: 'Di Carlo' }),
      getSettings: vi.fn().mockResolvedValue(settings({ filenameFormat: '{artist} - {title}' })),
      copyText,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    openMore()
    fireEvent.click(screen.getByTestId('copy-filename-btn'))
    await waitFor(() => expect(copyText).toHaveBeenCalledWith('Di Carlo - Bumping'))
  })

  // The search button skips the copy-paste round trip entirely: window.open routes the
  // Google URL through the main process to the default browser, the same path every
  // external link takes. The query must be URL-encoded or a "&" in a title breaks it.
  it('opens a Google search for the Settings-pattern file name in one click', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/raw 01.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Bumping', artist: 'Di Carlo' }),
      getSettings: vi.fn().mockResolvedValue(settings({ filenameFormat: '{artist} - {title}' })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    openMore()
    fireEvent.click(screen.getByTestId('search-web-btn'))
    expect(open).toHaveBeenCalledWith('https://www.google.com/search?q=Di%20Carlo%20-%20Bumping')
    open.mockRestore()
  })
})

// The metadata header keeps two tag actions in sight and tucks the rest into one menu.
const openMore = (): void => {
  if (!screen.queryByRole('menu')) fireEvent.click(screen.getByTestId('meta-more'))
}

describe('App open with', () => {
  // "Open With Surco" in Finder launches the app and hands the chosen file to the OS
  // open-file event, which the main process buffers (the renderer isn't alive yet on a
  // cold launch). The renderer must drain that buffer on mount so the file lands in the
  // list exactly as a drop would — otherwise the menu entry opens an empty window.
  it('adds files handed over by the OS on launch (Open With)', async () => {
    setApi({
      takePendingFiles: vi.fn().mockResolvedValue(['/music/opened.flac']),
      readTags: vi.fn().mockResolvedValue({ title: 'Opened', artist: 'Artist' }),
    })
    await renderApp()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // While the app is already running, opening another file from Finder pushes it straight
  // to the live window through onOpenFiles. The same path that fed the cold-launch drain
  // must also accept these so a second "Open With" appends to the existing crate.
  it('appends files pushed to an already-running window', async () => {
    let push: ((paths: string[]) => void) | undefined
    setApi({
      onOpenFiles: (cb: (paths: string[]) => void) => {
        push = cb
        return () => {}
      },
      readTags: vi.fn().mockResolvedValue({ title: 'Live', artist: 'Artist' }),
    })
    await renderApp()
    await screen.findByTestId('add-files')
    push?.(['/music/live.flac'])
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  it('brings the working list forward when files are opened while a source is showing, so they are not left in a hidden list', async () => {
    let push: ((paths: string[]) => void) | undefined
    setApi({
      onOpenFiles: (cb: (paths: string[]) => void) => {
        push = cb
        return () => {}
      },
      readTags: vi.fn().mockResolvedValue({ title: 'Live', artist: 'Artist' }),
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    await waitFor(() =>
      expect(screen.getByTestId('source-rail-rekordbox')).toHaveAttribute('aria-pressed', 'true'),
    )
    await act(async () => push?.(['/music/live.flac']))
    await waitFor(() =>
      expect(screen.getByTestId('source-rail-tracks')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })
})

describe('App non-audio notice', () => {
  function notAudioApi(): void {
    let report: ((count: number) => void) | undefined
    setApi({
      getPathForFile: vi.fn((f: File) => `/m/${f.name}`),
      onNotAudioSkipped: (cb: (count: number) => void) => {
        report = cb
        return () => {}
      },
      expandPaths: vi.fn(async (paths: string[], reportNotAudio?: boolean) => {
        const notAudio = paths.filter((p) => p.endsWith('.txt'))
        if (reportNotAudio && notAudio.length) report?.(notAudio.length)
        return paths.filter((p) => !p.endsWith('.txt'))
      }),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
  }

  it('says how many dropped files were skipped for not being audio, beside the ones that loaded', async () => {
    notAudioApi()
    await renderApp()

    fireEvent.drop(await screen.findByTestId('empty-dropzone'), {
      dataTransfer: fakeDataTransfer([
        new File([''], 'notes.txt'),
        new File([''], 'lyrics.txt'),
        new File([''], 'a.wav'),
      ]),
    })

    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      i18n.t('notices.notAudioSkipped', { count: 2 }),
    )
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })

  it('says so for a lone dropped file that is not audio instead of doing nothing', async () => {
    notAudioApi()
    await renderApp()

    fireEvent.drop(await screen.findByTestId('empty-dropzone'), {
      dataTransfer: fakeDataTransfer([new File([''], 'notes.txt')]),
    })

    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      i18n.t('notices.notAudioSkipped', { count: 1 }),
    )
  })
})

describe('App multi-select convert', () => {
  // The reason this matters: users with a large crate (e.g. 400 tracks) tag a handful, select
  // just those, and hit convert expecting only the selection to run. Converting the whole list
  // would rewrite files they hadn't finished — the multi-select convert must honour the selection.
  it('converts only the selected tracks, not the whole list', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    const convert = await screen.findByTestId('process-btn')
    expect(convert).toHaveTextContent(i18n.t('header.convertSelected', { count: 2 }))
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    const converted = processTrack.mock.calls.map((c) => c[0].inputPath).sort()
    expect(converted).toEqual(['/music/a.wav', '/music/b.wav'])
  })

  // "Same as source" promises every file keeps its own format through a mixed batch. The
  // editor resolves 'source' against the anchor track before it ever reaches processAll, so
  // a WAV+MP3+FLAC selection collapsed onto whichever format the anchor happened to be —
  // silently re-encoding (and degrading) the other two. Each job must carry ITS OWN track's
  // format, never the anchor's.
  it('keeps each track in its own format when Default format is "Same as source" over a mixed multi-selection', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'source' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3', '/music/c.flac']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    // Selects all three: the anchor (a.wav) plus b.mp3 and c.flac via range-select.
    fireEvent.click(rows[0])
    fireEvent.click(rows[2], { shiftKey: true })
    const convert = await screen.findByTestId('process-btn')
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(3))
    const byInput = Object.fromEntries(
      processTrack.mock.calls.map((c) => [c[0].inputPath as string, c[0].format as string]),
    )
    expect(byInput).toEqual({
      '/music/a.wav': 'wav',
      '/music/b.mp3': 'mp3',
      '/music/c.flac': 'flac',
    })
  })

  // The multi-select button shows the Settings default until the user opens its menu, and
  // it sent that label back as if it had been picked by hand. A picked format outranks the
  // respect for an Apple Music import's own format, so every imported WAV in the selection
  // was re-encoded to the default without anyone choosing it.
  it('keeps Apple Music imports in their own format unless a format is picked by hand', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'aiff' })),
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        paths: ['/music/a.wav', '/music/b.wav'],
        edits: {
          '/music/a.wav': {
            meta: { ...emptyMetadata(), title: 'T', artist: 'A' },
            fromAppleMusic: true,
          },
          '/music/b.wav': {
            meta: { ...emptyMetadata(), title: 'T', artist: 'A' },
            fromAppleMusic: true,
          },
        },
      }),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    expect(processTrack.mock.calls.map((c) => c[0].format)).toEqual(['wav', 'wav'])
  })

  // "Convert again" over a done selection runs the batch, whose gate skipped done tracks,
  // so the menu promised a re-export and converted nothing (06/11).
  it('converts a done selection again from the done menu', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/music/a.aiff', inPlace: false })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    fireEvent.click(await screen.findByTestId('done-more'))
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(4))
  })

  // The editor's convert button sent the format it showed, which the keep rule itself had
  // chosen, as if the user had picked it. Beside the original that wrote a "(2).mp3" next to
  // the file the setting promises to leave alone, while Convert all already left it be.
  it('leaves a kept MP3 alone beside the original when converted from the editor, and says why', async () => {
    const processTrack = vi
      .fn()
      .mockResolvedValue({ outputPath: '/music/b (2).mp3', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(
        settings({
          outputFormat: 'aiff',
          keepMp3Sources: true,
          convertBesideOriginal: true,
          overwriteOriginal: false,
          addToAppleMusic: false,
        }),
      ),
      pickFiles: vi.fn().mockResolvedValue(['/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'Promo', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    fireEvent.click((await screen.findAllByTestId('track-row'))[0])
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() =>
      expect(screen.getByTestId('app-notice')).toHaveTextContent('stays as it is'),
    )
    expect(processTrack).not.toHaveBeenCalled()
  })

  // The destination is seeded against the anchor track alone: a FLAC anchor pins it to the
  // output folder because Music can't take FLAC. Sent as a pick for the whole selection, it
  // kept every MP3 of the batch out of Apple Music too, which the user never asked for.
  it('leaves the destination to each track unless one is picked by hand', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ outputFormat: 'source', addToAppleMusic: true })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.flac', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    const mp3Job = processTrack.mock.calls.find((c) => c[0].inputPath === '/music/b.mp3')?.[0]
    expect(mp3Job.addToAppleMusic).toBeUndefined()
  })

  function hangingConvert() {
    const pending: ((v: unknown) => void)[] = []
    const processTrack = vi.fn(() => new Promise((resolve) => pending.push(resolve)))
    const cancelJob = vi.fn(() => {
      for (const resolve of pending.splice(0))
        resolve({ outputPath: '', inPlace: false, skipped: true })
    })
    return { processTrack, cancelJob }
  }

  it('shows the running batch in the editor footer and cancels it there, wherever the selection moves', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      cancelJob,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    expect(await screen.findByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'false'),
    )
    expect(screen.getByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
    expect(screen.queryByTestId('process-btn')).toBeNull()
    fireEvent.click(screen.getByTestId('batch-run-cancel'))
    expect(cancelJob).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
    expect(await screen.findByTestId('process-btn')).toBeInTheDocument()
    expect(screen.getByTestId('batch-summary')).toHaveTextContent('Cancelled')
  })

  it('shows the running batch and its cancel under the empty editor when the list converts with no track open', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    expect(screen.queryByTestId('batch-run')).toBeNull()
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true, shiftKey: true })
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    expect(await screen.findByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
    fireEvent.click(screen.getByTestId('batch-run-cancel'))
    expect(cancelJob).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
  })

  it('starts and cancels the list batch from the menu with no track open, the footer following it', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    runMenu('process-all')
    expect(await screen.findByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
    runMenu('process-all')
    expect(cancelJob).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
  })

  it('keeps the running batch and its cancel on screen while Copias is open', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      trashList: vi.fn().mockResolvedValue([]),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    runMenu('backups')
    await screen.findByTestId('copies-screen')
    expect(screen.getByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
    fireEvent.click(screen.getByTestId('batch-run-cancel'))
    expect(cancelJob).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
  })

  it('keeps keyboard focus on screen when the batch ends under the empty editor while its Cancel had it', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    runMenu('select-all')
    runMenu('select-all')
    await waitFor(() => expect(screen.queryByTestId('field-title')).toBeNull())
    runMenu('process-all')
    const cancel = await screen.findByTestId('batch-run-cancel')
    expect(screen.queryByTestId('process-btn')).toBeNull()
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
    expect(document.activeElement?.isConnected).toBe(true)
  })

  it('keeps keyboard focus on screen when the batch ends over Copias while its Cancel had it', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      trashList: vi.fn().mockResolvedValue([]),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    runMenu('backups')
    await screen.findByTestId('copies-screen')
    const cancel = screen.getByTestId('batch-run-cancel')
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
    expect(document.activeElement).not.toBe(document.body)
    expect(screen.getByTestId('copies-screen').parentElement).toContainElement(
      document.activeElement as HTMLElement,
    )
  })

  it('hands focus to the playlists when the batch ends under a source with none picked, the panel having no control left', async () => {
    const { processTrack, cancelJob } = hangingConvert()
    setApi({
      platform: 'darwin',
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Warm up', count: 1 }]),
      processTrack,
      cancelJob,
    })
    await renderApp()
    await addTwoTracks()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    await screen.findByTestId('source-pick-playlist')
    const cancel = screen.getByTestId('batch-run-cancel')
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
    expect(document.activeElement).toBe(screen.getByTestId('source-node-p1'))
  })

  // Tagging an album starts by dropping it: the files that just arrived are the ones the
  // next edit is for, and selecting them by hand was a step before every single album.
  it('selects the files that were just added, leaving the earlier ones out', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/a.wav'])
        .mockResolvedValueOnce(['/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(await screen.findByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 2 }),
    )
  })

  // A folder walk hands its files over while it is still walking, before the add itself
  // returns: those rows arrived with this drop too, and one of three stayed unselected.
  it('selects the files a walk delivered before it finished', async () => {
    let deliver: (paths: string[]) => void = () => {}
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      onExpandedBatch: (listener: (paths: string[]) => void) => {
        deliver = listener
        return () => {}
      },
      expandPaths: vi.fn(async (paths: string[]) => {
        deliver(paths.slice(0, 1))
        await new Promise((r) => setTimeout(r, 0))
        return paths
      }),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(await screen.findByTestId('process-btn')).toHaveTextContent(
      i18n.t('header.convertSelected', { count: 3 }),
    )
  })

  // A folder on a NAS can take many seconds to walk. A track picked meanwhile is what the
  // DJ is working on now, and the walk finishing must not take the editor away from it.
  it('keeps a selection made while the added files were still arriving', async () => {
    let finish: () => void = () => {}
    const walking = new Promise<void>((resolve) => {
      finish = resolve
    })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/a.wav', '/music/b.wav'])
        .mockResolvedValueOnce(['/music/c.wav', '/music/d.wav']),
      expandPaths: vi.fn(async (paths: string[]) => {
        if (paths.includes('/music/c.wav')) await walking
        return paths
      }),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('add-files'))
    await waitFor(() => expect(window.api.expandPaths).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await act(async () => {
      finish()
      await walking
    })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(4))
    expect(
      screen.getAllByTestId('track-row').filter((r) => r.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1)
    expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true')
  })

  // With a filter on, some of what arrives may not be on screen: selecting it would leave
  // the convert button acting on rows nobody can see.
  it('leaves the selection alone when files are added under an active filter', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/a.mp3', '/music/z.wav'])
        .mockResolvedValueOnce(['/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    runMenu('add')
    await waitFor(() => expect(window.api.readTags).toHaveBeenCalledTimes(4))
    expect(
      screen.getAllByTestId('track-row').filter((r) => r.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1)
  })

  // "busco algo y añado una pista nueva... la pista nueva no la veo": a search left over
  // from earlier hid what was just added, so the add looked like it had done nothing.
  it('clears a search that would hide the files just added, and selects them', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/alpha.wav', '/music/zulu.wav'])
        .mockResolvedValueOnce(['/music/bravo.wav']),
      readTags: vi.fn().mockResolvedValue({ title: '', artist: '' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    runMenu('add')

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(screen.getByTestId('track-search')).toHaveValue('')
    const bravo = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes('bravo'))
    expect(bravo).toHaveAttribute('aria-selected', 'true')
  })

  // Typing the search and then dragging the file in from Finder leaves the cursor in the
  // search box. Treating it as a field being typed in left the new track unselected, so the
  // editor kept showing the old one and the add still looked like it had done nothing.
  it('selects the files just added while the cursor is still in the track search', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/alpha.wav', '/music/zulu.wav'])
        .mockResolvedValueOnce(['/music/bravo.wav']),
      readTags: vi.fn().mockResolvedValue({ title: '', artist: '' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const search = screen.getByTestId('track-search')
    search.focus()
    fireEvent.change(search, { target: { value: 'alpha' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    runMenu('add')

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const bravo = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes('bravo'))
    await waitFor(() => expect(bravo).toHaveAttribute('aria-selected', 'true'))
  })

  // Dropping another version of the tune being searched for, to compare them, is a reason to
  // keep the search: everything added is on screen beside what was found.
  it('keeps a search that every file just added matches', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/alpha.wav', '/music/zulu.wav'])
        .mockResolvedValueOnce(['/music/alpha-remix.wav']),
      readTags: vi.fn().mockResolvedValue({ title: '', artist: '' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'alpha' } })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    runMenu('add')

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(screen.getByTestId('track-search')).toHaveValue('alpha')
    const remix = screen.getAllByTestId('track-row').find((r) => r.textContent?.includes('remix'))
    expect(remix).toHaveAttribute('aria-selected', 'true')
  })

  // A drop that lands while a field is being typed in must not swap the form under the
  // cursor for a bulk one.
  it('leaves the selection alone when files arrive while a field has the cursor', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi
        .fn()
        .mockResolvedValueOnce(['/music/a.wav'])
        .mockResolvedValueOnce(['/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    const title = await screen.findByTestId('field-title')
    title.focus()
    runMenu('add')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    expect(screen.getByTestId('field-title')).toBeInTheDocument()
    expect(
      screen.getAllByTestId('track-row').filter((r) => r.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1)
  })

  // The check after converting is how Surco says a file did not come out right. Clearing
  // the list took those tracks with the good ones, and the warning went with them.
  it('keeps in the list a converted track whose check did not add up', async () => {
    const processTrack = vi.fn().mockImplementation((job: { inputPath: string }) =>
      Promise.resolve({
        outputPath: '/out/x',
        inPlace: false,
        verification:
          job.inputPath === '/music/b.wav'
            ? {
                status: 'mismatch',
                checks: [{ place: 'file', state: 'mismatch', detail: { key: 'fileTruncated' } }],
              }
            : { status: 'ok', checks: [] },
      }),
    )
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ clearListAfterConvert: true })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(
      screen
        .getAllByTestId('app-notice')
        .some((card) =>
          card.textContent?.includes(i18n.t('notices.removedFromList', { count: 2 })),
        ),
    ).toBe(true)
  })

  // A check still running has not said anything yet: the track waits in the list for its
  // answer and only leaves once the answer is good.
  it('waits for a running check before clearing its track', async () => {
    let push: Parameters<Api['onVerifyUpdate']>[0] = () => {}
    const processTrack = vi.fn().mockResolvedValue({
      outputPath: '/out/x',
      inPlace: false,
      verification: {
        status: 'checking',
        checks: [{ place: 'file', state: 'checking', detail: { key: 'checking' } }],
        job: 'j1',
        seq: 0,
      },
    })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ clearListAfterConvert: true })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      onVerifyUpdate: vi.fn<Api['onVerifyUpdate']>((cb) => {
        push = cb
        return () => {}
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getAllByTestId('track-row')).toHaveLength(2)
    for (const [job] of processTrack.mock.calls)
      act(() => push(job.id, { status: 'ok', checks: [], job: 'j1', seq: 1 }))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
  })

  // The button said "Update" and the summary then said "converted": the DJ was left
  // wondering whether the files had been re-encoded after all.
  it('says the tracks were updated when the batch only rewrote tags', async () => {
    const processTrack = vi
      .fn()
      .mockResolvedValue({ outputPath: '/music/a.wav', inPlace: true, tagsOnly: true })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('process-all')
    expect(await screen.findByTestId('batch-summary')).toHaveTextContent(
      i18n.t('header.batchUpdated', { count: 2 }),
    )
  })

  it('still says converted when any track of the batch was converted', async () => {
    const processTrack = vi
      .fn()
      .mockResolvedValueOnce({ outputPath: '/music/a.wav', inPlace: true, tagsOnly: true })
      .mockResolvedValue({ outputPath: '/out/b.aiff', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('process-all')
    expect(await screen.findByTestId('batch-summary')).toHaveTextContent(
      i18n.t('header.batchConverted', { count: 2 }),
    )
  })

  // A batch raised one card per repaired track, each for four seconds: a folder of vinyl
  // rips covered the corner of the app with the same sentence over and over.
  it('gathers the click repairs of a batch into one notice that counts the tracks', async () => {
    const processTrack = vi
      .fn()
      .mockResolvedValue({ outputPath: '/out/x', inPlace: false, declickedSamples: 12 })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn(async (path: string) => ({
        title: path.endsWith('a.wav') ? 'Alpha' : path.endsWith('b.wav') ? 'Bravo' : 'Charlie',
        artist: 'A',
      })),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(3))
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('app-notice')
          .filter((card) =>
            card.textContent?.includes(i18n.t('notices.declickedMany', { count: 3 })),
          ),
      ).toHaveLength(1),
    )
    const cards = screen
      .getAllByTestId('app-notice')
      .filter((card) => /clicks/i.test(card.textContent ?? ''))
    expect(cards).toHaveLength(1)
    // A count alone left the DJ to guess which tracks it was about.
    for (const name of ['Alpha', 'Bravo', 'Charlie']) expect(cards[0]).toHaveTextContent(name)
  })

  // One repaired track still says which one and how much: the count only replaces the
  // name when there is more than one to name.
  it('names the track when a single one had clicks repaired', async () => {
    const processTrack = vi
      .fn()
      .mockResolvedValue({ outputPath: '/out/x', inPlace: false, declickedSamples: 12 })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Solo', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getAllByTestId('app-notice').some((card) => card.textContent?.includes('12')),
      ).toBe(true),
    )
  })

  it('saves the clear-after-batch setting from the batch footer menu and shows it marked', async () => {
    const saveSettings = vi.fn().mockResolvedValue(undefined)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings()),
      saveSettings,
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    fireEvent.click(await screen.findByTestId('process-format-toggle'))
    const option = (): HTMLElement => screen.getByTestId('process-clear-after')
    expect(option()).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(option())
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ clearListAfterConvert: true }),
    )
    await waitFor(() => expect(option()).toHaveAttribute('aria-checked', 'true'))
  })

  // With the setting on, the converted rows leave the list on their own and can be brought
  // back; the row that failed stays, so the failure is still there to look at.
  it('clears the converted tracks when the batch ends and keeps the one that failed', async () => {
    const processTrack = vi
      .fn()
      .mockImplementation((job: { inputPath: string }) =>
        job.inputPath === '/music/b.wav'
          ? Promise.reject(new Error('disk full'))
          : Promise.resolve({ outputPath: '/out/x', inPlace: false }),
      )
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ clearListAfterConvert: true })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    const removal = screen
      .getAllByTestId('app-notice')
      .find((card) => card.textContent?.includes(i18n.t('notices.removedFromList', { count: 2 })))
    if (!removal) throw new Error('no removal toast')
    fireEvent.click(within(removal).getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
  })

  it('applies a format and destination picked from the menu to the whole selection', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ outputFormat: 'source', addToAppleMusic: true })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.flac', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    const convert = await screen.findByTestId('process-btn')
    expect(convert).toHaveTextContent(i18n.t('header.updateSelected', { count: 2 }))
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-format-alac'))
    expect(screen.getByTestId('process-format-current')).toHaveTextContent('ALAC')
    fireEvent.click(screen.getByTestId('process-format-toggle'))
    fireEvent.click(screen.getByTestId('process-destination-beside'))
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    for (const [job] of processTrack.mock.calls) {
      expect(job.format).toBe('alac')
      expect(job.convertBesideOriginal).toBe(true)
    }
  })
})

// A batch's failure card is keyed, so thirty broken conversions raise one toast instead
// of thirty. That collapse is what made the card useless: it named the reason ("came out
// unreadable") but never the track, so the user was told something failed in a crate of
// hundreds and left to hunt for the red ring. The name is the whole point of the card.
// Convert all ran with the format the editor had seeded for whichever track was open, as if
// the user had picked it. With an MP3 open, "Same as source", keep-MP3 or an Apple Music
// import all resolve that track to MP3, and every FLAC and WAV in the batch was then
// re-encoded to lossy MP3 without anyone choosing it. Only a pick made by hand in the
// editor's menu speaks for the whole batch; otherwise each track resolves its own format.
describe('App convert all format with a track open', () => {
  async function convertAllWithMp3Open(overrides: Partial<Settings>, pick?: string) {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings(overrides)),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.mp3', '/music/b.flac', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await screen.findByTestId('process-format-toggle')
    if (pick) {
      fireEvent.click(screen.getByTestId('process-format-toggle'))
      fireEvent.click(screen.getByTestId(`process-format-${pick}`))
    }
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(3))
    return Object.fromEntries(
      processTrack.mock.calls.map((c) => [c[0].inputPath as string, c[0].format as string]),
    )
  }

  it('keeps each track in its own format under "Same as source" with an MP3 open', async () => {
    expect(await convertAllWithMp3Open({ outputFormat: 'source' })).toEqual({
      '/music/a.mp3': 'mp3',
      '/music/b.flac': 'flac',
      '/music/c.wav': 'wav',
    })
  })

  it('converts only the MP3 to itself under keep-MP3 with an MP3 open', async () => {
    expect(await convertAllWithMp3Open({ outputFormat: 'aiff', keepMp3Sources: true })).toEqual({
      '/music/a.mp3': 'mp3',
      '/music/b.flac': 'aiff',
      '/music/c.wav': 'aiff',
    })
  })

  it('previews the rename in the open track own format when nothing was picked', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'source' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('customize-output-name'))
    expect(await screen.findByTestId('rename-preview')).toHaveTextContent(/\.mp3$/)
  })

  it('still applies a format picked by hand in the editor to the whole batch', async () => {
    expect(await convertAllWithMp3Open({ outputFormat: 'aiff' }, 'wav')).toEqual({
      '/music/a.mp3': 'wav',
      '/music/b.flac': 'wav',
      '/music/c.wav': 'wav',
    })
  })
})

describe('App conversion failure notice', () => {
  it('names the failing track in the error toast', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Pray', artist: 'W.I.P.' }),
      processTrack: vi.fn().mockRejectedValue(new Error('came out unreadable')),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('process-btn'))
    const toast = await screen.findByTestId('process-error')
    expect(toast).toHaveTextContent('Pray')
    expect(toast).toHaveTextContent('came out unreadable')
    // A lone failure has no "others" to report, and i18next routes an English count of
    // 0 to the plural form — so the card read "and 0 more" until the key was picked by
    // hand. Pinned because the substring assertions above pass either way.
    expect(toast.textContent).not.toMatch(/more/)
  })

  it('says a full disk in the user language while the copy button and the report keep the raw text a bug report needs', async () => {
    const raw = "ENOSPC: no space left on device, write '/Volumes/USB/a.aiff'"
    const copyText = vi.fn().mockResolvedValue(undefined)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Pray', artist: 'W.I.P.' }),
      processTrack: vi.fn().mockRejectedValue(new Error(raw)),
      copyText,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(await screen.findByTestId('process-btn'))
    const toast = await screen.findByTestId('process-error')
    expect(toast).toHaveTextContent(i18n.t('errors.diskFull'))
    expect(toast).not.toHaveTextContent('ENOSPC')
    fireEvent.click(screen.getByTestId('process-error-copy'))
    expect(copyText).toHaveBeenCalledWith(expect.stringContaining(raw))
    fireEvent.click(screen.getByTestId('report-error'))
    expect(await screen.findByTestId('feedback-error')).toHaveTextContent(raw)
  })

  // Several failures in one run must still be one card, and it has to say how many —
  // naming only the first would understate the damage, and naming all thirty would be
  // the wall of cards the key exists to prevent.
  it('names the first failure and counts the rest when a batch fails several tracks', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi
        .fn()
        .mockResolvedValueOnce({ title: 'Pray', artist: 'A' })
        .mockResolvedValueOnce({ title: 'Second', artist: 'B' })
        .mockResolvedValueOnce({ title: 'Third', artist: 'C' }),
      processTrack: vi.fn().mockRejectedValue(new Error('came out unreadable')),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(screen.getAllByTestId('process-error')).toHaveLength(1))
    const toast = screen.getByTestId('process-error')
    expect(toast).toHaveTextContent('Pray')
    expect(toast).toHaveTextContent('2')
  })

  it('gives the reason of the track it names, not of the latest failure, so the user fixes the right problem', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi
        .fn()
        .mockResolvedValueOnce({ title: 'Pray', artist: 'A' })
        .mockResolvedValueOnce({ title: 'Second', artist: 'B' })
        .mockResolvedValueOnce({ title: 'Third', artist: 'C' }),
      processTrack: vi.fn(async ({ inputPath }: { inputPath: string }) => {
        if (inputPath === '/music/a.wav') throw new Error('file is missing')
        if (inputPath === '/music/c.wav') throw new Error('disk is full')
        return { outputPath: '/out/x.aiff', inPlace: false }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(screen.getByTestId('batch-failed-count')).toHaveTextContent('2'))
    const toast = screen.getByTestId('process-error')
    expect(toast).toHaveTextContent('Pray')
    expect(toast).toHaveTextContent('file is missing')
    expect(toast).not.toHaveTextContent('disk is full')
  })

  it('counts only the failures of the latest run, so a retry does not report the old run as new damage', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi
        .fn()
        .mockResolvedValueOnce({ title: 'Pray', artist: 'A' })
        .mockResolvedValueOnce({ title: 'Second', artist: 'B' })
        .mockResolvedValueOnce({ title: 'Third', artist: 'C' }),
      processTrack: vi.fn().mockRejectedValue(new Error('came out unreadable')),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    await waitFor(() => expect(screen.getByTestId('process-error')).toHaveTextContent('and 2 more'))
    await waitFor(() => expect(screen.getByTestId('batch-failed-count')).toBeInTheDocument())
    runMenu('process-all')
    await waitFor(() => expect(window.api.processTrack).toHaveBeenCalledTimes(6))
    await waitFor(() => expect(screen.getByTestId('batch-failed-count')).toBeInTheDocument())
    expect(screen.getByTestId('process-error')).toHaveTextContent('and 2 more')
  })

  // The run summary counts the failures ("2 failed") and the list already has a bucket
  // that isolates exactly those rows — but the count was inert text, so the user read
  // the number and still had to scan for red rings. Clicking it filters the list down
  // to the failures, which is the whole path from "something broke" to the rows.
  it('filters the list to the failures when the run summary count is clicked', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi
        .fn()
        .mockResolvedValueOnce({ title: 'Pray', artist: 'A' })
        .mockResolvedValueOnce({ title: 'Second', artist: 'B' })
        .mockResolvedValueOnce({ title: 'Third', artist: 'C' }),
      // Only the middle track fails, so the filtered list is a strict subset — a
      // whole-run failure would pass even if the click did nothing at all.
      processTrack: vi.fn(async ({ inputPath }: { inputPath: string }) => {
        if (inputPath === '/music/b.wav') throw new Error('came out unreadable')
        return { outputPath: '/out/x.aiff', inPlace: false }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    const failedCount = await screen.findByTestId('batch-failed-count')
    fireEvent.click(failedCount)
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-row')).toHaveTextContent('Second')
  })

  it('filters the list to the skipped tracks when the run summary skip count is clicked, each saying why it was skipped', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi
        .fn()
        .mockResolvedValueOnce({ title: 'Pray', artist: 'A' })
        .mockResolvedValueOnce({ title: 'Second', artist: 'B' })
        .mockResolvedValueOnce({ title: 'Third', artist: 'C' }),
      processTrack: vi.fn(async ({ inputPath }: { inputPath: string }) => {
        if (inputPath === '/music/b.wav') return { outputPath: '/out/x.aiff', inPlace: false }
        return { outputPath: '', inPlace: false, skipped: true }
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    runMenu('process-all')
    const skippedCount = await screen.findByTestId('batch-skipped-count')
    expect(skippedCount).toHaveTextContent('2 skipped')
    fireEvent.click(skippedCount)
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveTextContent('Pray')
    expect(rows[1]).toHaveTextContent('Third')
    for (const row of rows) {
      expect(within(row).getByTestId('track-status')).toHaveTextContent(
        'Skipped: you kept the existing file rather than replace it',
      )
    }
  })

  // Reported from a video: filtered to the 79 auto-matched rows, the button read "Convert
  // 81 tracks" and then converted 79. The run has to honour the filter.
  it('converts only the rows the filter leaves visible', async () => {
    const processTrack = vi.fn(async () => ({ outputPath: '/out/x.aiff', inPlace: false }))
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack).toHaveBeenCalledWith(
      expect.objectContaining({ inputPath: '/music/b.mp3' }),
    )
  })
})

// The Default format x input-extension matrix from the user's own single-track convert
// click. The editor always resolves 'source' to a concrete OutputFormat before it ever
// reaches onProcess (Editor.tsx's `format` state, seeded via resolveJobFormat) — only the
// multi-select path threads the raw FormatSetting through (see Editor.tsx's isMulti
// branch and onProcessAll), which is why 'source' multi-select and the .opus skip are
// covered separately below via multi-select, matching how the app actually reaches them.
// This fills the concrete-format cells across every importable extension.
describe('App Default format x input extension matrix', () => {
  it.each([
    ['aiff', 'wav', 'aiff'],
    ['aiff', 'mp3', 'aiff'],
    ['aiff', 'flac', 'aiff'],
    ['aiff', 'aiff', 'aiff'],
    ['mp3', 'wav', 'mp3'],
    ['mp3', 'mp3', 'mp3'],
    ['mp3', 'flac', 'mp3'],
    ['mp3', 'aiff', 'mp3'],
    ['flac', 'wav', 'flac'],
    ['flac', 'mp3', 'flac'],
    ['flac', 'flac', 'flac'],
    ['flac', 'aiff', 'flac'],
  ] as const)(
    'Default format %s over a .%s file sends format %s',
    async (settingFormat, inputExt, expectedFormat) => {
      const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
      setApi({
        getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: settingFormat })),
        pickFiles: vi.fn().mockResolvedValue([`/music/a.${inputExt}`]),
        readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
        processTrack,
      })
      await renderApp()
      const rows = await addOneTrack()
      fireEvent.click(rows[0])
      const convert = await screen.findByTestId(
        settingFormat === inputExt ? 'convert-update-anyway' : 'process-btn',
      )
      fireEvent.click(convert)
      await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
      expect(processTrack.mock.calls[0][0].format).toBe(expectedFormat)
    },
  )

  // 'source' over a mixed wav+flac+aiff multi-selection: the existing multi-select
  // 'source' test above already covers wav/mp3/flac; this rounds out aiff, the one
  // formatMatchesInput branch it doesn't touch.
  it('keeps a .aiff track in the multi-selection on its own format under "Same as source"', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'source' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.aiff']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { shiftKey: true })
    const convert = await screen.findByTestId('process-btn')
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    const byInput = Object.fromEntries(
      processTrack.mock.calls.map((c) => [c[0].inputPath as string, c[0].format as string]),
    )
    expect(byInput).toEqual({ '/music/a.wav': 'wav', '/music/b.aiff': 'aiff' })
  })

  // .opus has no output equivalent under 'source' — only reachable from the App through
  // a multi-select convert (isMulti keeps the raw FormatSetting), same as the mixed-batch
  // test above. This pins the skip exactly as the user hits it: added, selected alongside
  // a real track, converted — the .opus row must be left alone while its sibling proceeds.
  it('skips a .opus track inside a multi-select convert under "Same as source"', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'source' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.opus']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { shiftKey: true })
    const convert = await screen.findByTestId('process-btn')
    fireEvent.click(convert)
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0].inputPath).toBe('/music/a.wav')
  })
})

describe('App editor format/destination reseed', () => {
  // The editor seeds `format` from the Default format setting only once, on mount —
  // changing the setting in Settings while the editor is still open on the same track
  // used to leave it stale. That isn't just a stale label: the stale format is what the
  // convert button actually sends, so a FLAC-seeded editor kept rewriting the source
  // .flac in place instead of producing the AIFF the user just asked for in Settings.
  it("reseeds the open editor's format when Default format changes in Settings", async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false })
    const base = settings({ outputFormat: 'flac', addToAppleMusic: true })
    setApi({
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(base),
      // Mirrors what main actually does: persist the patch and hand back the merged
      // settings — the modal's saves round-trip through this, same as the app.
      saveSettings: vi.fn((patch) => Promise.resolve({ ...base, ...patch })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.flac']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    const rows = await addOneTrack()
    fireEvent.click(rows[0])
    // Same format as the source .flac: the button offers to update it in place.
    expect(await screen.findByTestId('convert-up-to-date')).toHaveTextContent('No changes')

    fireEvent.click(screen.getByTestId('open-settings'))
    fireEvent.click(await screen.findByTestId('settings-tab-conversion'))
    fireEvent.click(screen.getByTestId('settings-format-aiff'))
    fireEvent.click(screen.getByTestId('settings-close'))

    await waitFor(() =>
      expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF'),
    )
    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0].format).toBe('aiff')
  })

  // Same one-shot seeding bug on the other axis: the destination picker (Apple
  // Music/folder/Engine/beside/overwrite) is seeded from Settings once too. Left
  // stale, a track that just started as a folder export keeps going to the folder
  // even after the user switches the Settings destination to Apple Music.
  it("reseeds the open editor's destination when the destination setting changes in Settings", async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false })
    const base = settings({ outputFormat: 'aiff', addToAppleMusic: false })
    setApi({
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(base),
      saveSettings: vi.fn((patch) => Promise.resolve({ ...base, ...patch })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    const rows = await addOneTrack()
    fireEvent.click(rows[0])
    expect(await screen.findByTestId('process-format-current')).toHaveTextContent('AIFF')

    fireEvent.click(screen.getByTestId('open-settings'))
    await screen.findByTestId('settings-tab-naming')
    openTab('naming', 'destination')
    fireEvent.click(screen.getByTestId('settings-destination-appleMusic'))
    fireEvent.click(screen.getByTestId('settings-close'))

    fireEvent.click(screen.getByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0].addToAppleMusic).toBe(true)
  })
})

describe('App normalize peak preferences', () => {
  const normalizeOpen: Partial<Settings> = {
    editorSections: DEFAULT_EDITOR_SECTIONS.map((s) =>
      s.id === 'normalize' ? { ...s, open: true } : s,
    ),
  }

  // "Remove DC offset" and "Normalize stereo channels independently" describe how the
  // user always wants peak normalization done, not a one-track choice — user feedback:
  // relaunching the app must find them as they were left. So a toggle in the editor
  // writes the two flags back to Settings, while mode/targets stay per-track.
  it('persists an editor checkbox toggle back to Settings', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    // The section ships folded now, so the stored settings open it to reach the dials.
    setApi({ saveSettings, getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)) })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    fireEvent.click(screen.getByTestId('normalize-remove-dc'))
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        normalize: {
          mode: 'none',
          targetLufs: -14,
          truePeakDb: -1,
          peakDb: -1,
          removeDcOffset: true,
          peakRemoveDc: false,
          peakPerChannel: false,
        },
      }),
    )
  })

  // The regression: the peak/loudness INPUT is a lasting value too, not just the
  // checkboxes — editing it in a track must persist to Settings (mode preserved) so
  // the next track inherits it, exactly like the checkboxes already do.
  it('persists an editor input change back to Settings, mode preserved', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({ saveSettings, getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)) })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    fireEvent.change(screen.getByTestId('normalize-peak'), { target: { value: '-1.5' } })
    fireEvent.blur(screen.getByTestId('normalize-peak'))
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          normalize: expect.objectContaining({ mode: 'none', peakDb: -1.5 }),
        }),
      ),
    )
  })

  // With several tracks selected the section says its dial applies to all of them. It
  // was staged on the anchor alone, so a track carrying its own earlier mode converted
  // with that one instead, with nothing on screen saying so.
  it('applies the volume picked for a selection to every track in it', async () => {
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/out/x.aiff',
    } as Awaited<ReturnType<Api['processTrack']>>)
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      processTrack,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[1])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getAllByTestId('track-row')[1], { shiftKey: true })
    await screen.findByTestId('normalize-scope')
    fireEvent.click(screen.getByTestId('normalize-mode-loudness'))
    fireEvent.click(await screen.findByTestId('process-btn'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(2))
    expect(processTrack.mock.calls.map((c) => c[0].normalize?.mode)).toEqual([
      'loudness',
      'loudness',
    ])
  })

  // The per-track mode pick stays one-shot: switching to peak alone must not touch
  // Settings, or every editor visit would flip the global default.
  it('never writes Settings for a bare per-track mode switch', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({ saveSettings, getSettings: vi.fn().mockResolvedValue(settings(normalizeOpen)) })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(await screen.findByTestId('normalize-mode-peak'))
    await screen.findByTestId('normalize-remove-dc')
    expect(saveSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ normalize: expect.anything() }),
    )
  })
})

describe('App keyboard shortcuts', () => {
  // ⌘K (Ctrl+K off macOS) opens the command palette from anywhere, and Escape closes
  // it — the two keys the global handler special-cases before any track command.
  it('opens the command palette with the shortcut and closes it on Escape', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(await screen.findByTestId('palette-input')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette-input')).toBeNull())
  })

  // Type a title, ⌘⏎: the field holds the text for a 200 ms pause before committing, so the
  // conversion read the old title, the selection moved on and the unmount threw the typed
  // text away. The keystroke that converts has to convert what is on screen, keep it on the
  // track it was typed into, and leave the next track's own title alone.
  it('converts the text just typed when ⌘⏎ lands inside the typing pause', async () => {
    const processTrack = vi
      .fn<Api['processTrack']>()
      .mockResolvedValue({ outputPath: '/o/a.aiff', inPlace: false })
    setApi({
      readTags: vi.fn(async (path: string) => ({
        title: path.endsWith('a.wav') ? 'Alpha' : 'Bravo',
        artist: 'DJ',
      })),
      processTrack,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Typed Name' } })
    fireEvent.keyDown(screen.getByTestId('field-title'), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0].meta.title).toBe('Typed Name')
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Typed Name'))
  })

  // The selection can move without the field ever blurring. The text still in its pause
  // belongs to the track it was typed into: dropped, the edit was lost; committed as the
  // field unmounted, it landed on the track just opened and replaced its tags.
  it('keeps text typed into one track on that track when the selection moves', async () => {
    setApi({
      readTags: vi.fn(async (path: string) => ({
        title: path.endsWith('a.wav') ? 'Alpha' : 'Bravo',
        artist: 'DJ',
      })),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Typed Name' } })
    fireEvent.click(rows[1])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Typed Name'))
    fireEvent.click(screen.getAllByTestId('track-row')[1])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))
  })

  it('steps to the next track with ⌥↓ from inside a field, keeping the typed text on its track and the cursor in that same field rather than the first one, so a list is tagged without leaving the keyboard', async () => {
    setApi({
      readTags: vi.fn(async (path: string) => ({
        title: path.endsWith('a.wav') ? 'Alpha' : 'Bravo',
        artist: path.endsWith('a.wav') ? 'Ann' : 'Bob',
      })),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
    expect(screen.getByTestId('field-artist')).toHaveValue('Ann')
    screen.getByTestId('field-artist').focus()
    fireEvent.change(screen.getByTestId('field-artist'), { target: { value: 'Typed Artist' } })
    fireEvent.keyDown(screen.getByTestId('field-artist'), { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue('Bob'))
    expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveFocus())
    fireEvent.keyDown(screen.getByTestId('field-artist'), { key: 'ArrowUp', altKey: true })
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue('Typed Artist'))
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveFocus())
  })

  // The palette button is a bare glyph, so its hover hint is the only place the bar shows
  // its shortcut. ⌘K is a fixed menu accelerator outside the rebindable table, and the hint
  // read only that table, so the tooltip said "Command palette" with no keys at all.
  it('shows the palette shortcut on the palette button', async () => {
    await renderApp()
    expect(screen.getByTestId('open-palette')).toHaveTextContent(/(⌘|Ctrl\+)K/)
  })
})

describe('App command palette', () => {
  // A palette command whose action opens another modal (here Settings) must land on that
  // modal, not be swallowed when the palette closes itself in the same click.
  it('keeps the command-opened modal up after the palette closes itself', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Settings' } })
    fireEvent.click(screen.getByTestId('palette-item'))
    await waitFor(() => expect(screen.getByTestId('settings-tab-general')).toBeInTheDocument())
    expect(screen.queryByTestId('palette-input')).toBeNull()
  })
})

describe('App on Windows', () => {
  async function paletteTitles(): Promise<string[]> {
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    await screen.findByTestId('palette-input')
    return screen.getAllByTestId('palette-item').map((item) => item.textContent ?? '')
  }

  it('offers no Apple Music command in the palette, since Windows has no Music to add to', async () => {
    await renderApp()
    await addTwoTracks()

    expect((await paletteTitles()).filter((title) => title.includes('Apple Music'))).toEqual([])
  })

  it('names File Explorer in the palette, the place a Windows user actually lands', async () => {
    await renderApp()
    await addTwoTracks()

    const titles = await paletteTitles()
    expect(titles.filter((title) => title.includes('Finder'))).toEqual([])
    expect(titles.some((title) => title.startsWith('Show in File Explorer'))).toBe(true)
  })

  async function shortcutTitles(): Promise<string[]> {
    fireEvent.click(await screen.findByTestId('open-settings'))
    fireEvent.click(await screen.findByTestId('settings-tab-shortcuts'))
    return screen
      .getAllByTestId(/^shortcut-row-/)
      .map((row) => row.querySelector('span')?.textContent ?? '')
  }

  it('lists no Apple Music shortcut a Windows user could never trigger', async () => {
    await renderApp()

    expect((await shortcutTitles()).filter((title) => title.includes('Apple Music'))).toEqual([])
  })

  it('names File Explorer in the shortcuts, not Finder', async () => {
    await renderApp()

    const titles = await shortcutTitles()
    expect(titles.filter((title) => title.includes('Finder'))).toEqual([])
    expect(titles).toContain('Show in File Explorer')
  })

  describe('with an Apple Music destination synced from a Mac', () => {
    const synced = settings({ addToAppleMusic: true, keepOutputCopy: false, outputDir: '/out' })

    it('offers to convert, since Apple Music does not exist on Windows', async () => {
      setApi({ getSettings: vi.fn().mockResolvedValue(synced) })
      await renderApp()
      fireEvent.click((await addTwoTracks())[0])

      expect(await screen.findByTestId('process-btn')).toHaveTextContent(/Convert$/)
      expect(screen.getByTestId('process-format-current')).toHaveTextContent('AIFF')
    })

    it('checks the output folder in Settings instead of leaving no destination picked', async () => {
      setApi({ getSettings: vi.fn().mockResolvedValue(synced) })
      await renderApp()
      fireEvent.click(await screen.findByTestId('open-settings'))
      await screen.findByTestId('settings-tab-naming')
      openTab('naming', 'destination')

      expect(await screen.findByTestId('settings-destination-folder')).toBeChecked()
    })
  })
})

describe('App track numbering', () => {
  // Rips with no Discogs release carry no positions; numbering stamps the list order
  // as 1..N so the album still exports in the right sequence — and ⌘Z takes it back.
  it('numbers the visible tracks in list order from the palette', async () => {
    // The fixture's default field set hides Track No.; the assertion reads it. Both
    // mocks must agree: a launch-time save's response replaces the settings state.
    const fields = settings({ visibleFields: ['title', 'artist', 'trackNumber'] })
    setApi({
      getSettings: vi.fn().mockResolvedValue(fields),
      saveSettings: vi.fn<Api['saveSettings']>().mockResolvedValue(fields),
      readTags: vi.fn().mockResolvedValue({}),
    })
    await renderApp()
    const rows = await addTwoTracks()

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    // "Number" alone also matches "Remove numbering from title"; filter on the phrase
    // that belongs to this command only, so the palette resolves to a single entry.
    fireEvent.change(input, { target: { value: 'Number tracks' } })
    fireEvent.click(screen.getByTestId('palette-item'))

    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('field-trackNumber')).toHaveValue('1'))
    fireEvent.click(rows[1])
    await waitFor(() => expect(screen.getByTestId('field-trackNumber')).toHaveValue('2'))

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('field-trackNumber')).toHaveValue(''))
  })
})

describe('App settings button', () => {
  // The header button wires onClick straight to the opener, so React hands it the click
  // event. The opener used to read that event as its tab argument, leaving the modal on a
  // bogus tab with no panel selected and an empty body. Opening must always land on General.
  it('opens the settings modal on the General tab', async () => {
    await renderApp()
    fireEvent.click(screen.getByTestId('open-settings'))
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-general')).toHaveAttribute('aria-selected', 'true'),
    )
  })
})

describe('App background work signal', () => {
  // The dot on the activity button is the one always-visible sign that a search, a cover
  // download or an Apple Music read is running while the panel is closed.
  it('marks the activity button while the activity log shows work in flight', async () => {
    let emit: ((event: ActivityEvent) => void) | undefined
    setApi({
      onActivity: (cb: (event: ActivityEvent) => void) => {
        emit = cb
        return () => {}
      },
    })
    await renderApp()
    await screen.findByTestId('add-files')
    expect(screen.queryByTestId('activity-running')).toBeNull()
    act(() =>
      emit?.({ id: 'a1', kind: 'discogs', phase: 'start', labelKey: 'activity.searchDiscogs' }),
    )
    expect(screen.getByTestId('activity-running')).toBeInTheDocument()
    act(() =>
      emit?.({ id: 'a1', kind: 'discogs', phase: 'done', labelKey: 'activity.searchDiscogs' }),
    )
    expect(screen.queryByTestId('activity-running')).toBeNull()
  })
})

describe('App stats', () => {
  it('opens Settings on the stats tab from the menu', async () => {
    await renderApp()
    await screen.findByTestId('add-files')
    runMenu('stats')
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-stats')).toHaveAttribute('aria-selected', 'true'),
    )
  })

  it('opens Settings on the stats tab from the toolbar button', async () => {
    await renderApp()
    fireEvent.click(await screen.findByTestId('open-stats'))
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-stats')).toHaveAttribute('aria-selected', 'true'),
    )
  })
})

describe('App landmarks', () => {
  // A screen reader user lands in an app with no document outline; a single top-level
  // heading names the window so they know where they are.
  it('exposes a top-level heading for orientation', async () => {
    await renderApp()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })
})

describe('App command palette list-wide actions', () => {
  // The list-wide toolbar actions are reachable from the palette too, so a keyboard-only
  // user can run them without hunting for the icon. Stats needs no loaded tracks, so it
  // proves the run wiring on its own.
  it('runs a list-wide action from the palette (Stats opens its settings tab)', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Stats' } })
    const items = screen.getAllByTestId('palette-item')
    expect(items).toHaveLength(1)
    fireEvent.click(items[0])
    await waitFor(() =>
      expect(screen.getByTestId('settings-tab-stats')).toHaveAttribute('aria-selected', 'true'),
    )
  })

  // The list-wide commands act on the whole crate, so they stay disabled until something
  // is loaded — the palette must honour the same gate the toolbar buttons do.
  it('disables the list-wide commands until tracks are loaded', async () => {
    await renderApp()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'Export' } })
    expect(screen.getByTestId('palette-item')).toHaveAttribute('aria-disabled', 'true')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await addTwoTracks()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'Export' } })
    expect(screen.getByTestId('palette-item')).toHaveAttribute('aria-disabled', 'false')
  })

  // Asking "are you sure?" after the DJ explicitly picked "Clear the list" questions an order
  // they just gave. The edits that live only in memory are what a clear could cost, so the
  // toast's Undo is the net that has to bring them back instead.
  it('clears at once from the palette and Undo brings the rows back with their unsaved edits', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    await addOneTrack()
    const title = await screen.findByTestId('field-title')
    fireEvent.change(title, { target: { value: 'Hand Typed' } })
    fireEvent.blur(title)
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), {
      target: { value: 'Clear the list' },
    })
    fireEvent.click(screen.getByTestId('palette-item'))

    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    expect(await screen.findByTestId('app-notice-message')).toHaveTextContent(
      i18n.t('notices.removedFromList', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('app-notice-action'))

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('track-row'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Hand Typed'))
  })

  // The toast offers Undo right after converting, which is exactly when a DJ clears. A row
  // that came back looking unconverted would be converted again by the next Convert all,
  // writing a second "(2)" copy beside the first or asking about a conflict for every file.
  it('brings a converted row back still converted, so Convert all does not redo it', async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    await addOneTrack()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    await screen.findByTestId('done-more')
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), {
      target: { value: 'Clear the list' },
    })
    fireEvent.click(screen.getByTestId('palette-item'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    fireEvent.click(await screen.findByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('track-row'))
    expect(await screen.findByTestId('done-more')).toBeInTheDocument()
    runMenu('process-all')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(processTrack).toHaveBeenCalledTimes(1)
  })

  // A row read from an Apple Music playlist carries its library identity, and nothing on
  // disk says so. Lost on Undo, the next convert re-encodes the import to the default format
  // and offers to add a song the library already has. Kept, the WAV stays a WAV and its
  // in-place export reads as up to date until forced.
  it("keeps an Apple Music row's identity when its removal is undone", async () => {
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/x', inPlace: false })
    setApi({
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(settings({ outputFormat: 'aiff' })),
      readTags: vi.fn().mockResolvedValue({ title: 'Bravo', artist: 'DJ' }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Friday', count: 1 }]),
      loadAppleMusicPlaylistTracks: vi.fn<Api['loadAppleMusicPlaylistTracks']>().mockResolvedValue({
        paths: ['/m/b.wav'],
        persistentIds: { '/m/b.wav': 'PID1' },
        meta: {},
        missing: 0,
      }),
      processTrack,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(await screen.findByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    fireEvent.click(await screen.findByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('track-row'))
    fireEvent.click(await screen.findByTestId('convert-update-anyway'))
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    expect(processTrack.mock.calls[0][0]).toMatchObject({
      format: 'wav',
      musicPersistentId: 'PID1',
    })
  })

  // The row's quality dot reads verdicts from the analysis cache, which the removal evicted.
  // Undo has to fetch them back from disk, or a measured track would come back unmeasured.
  it('fetches the cached analyses again for the rows Undo brings back', async () => {
    const loadCachedAnalyses = vi.fn<Api['loadCachedAnalyses']>().mockResolvedValue({})
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      loadCachedAnalyses,
    })
    await renderApp()
    await addOneTrack()
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    const before = loadCachedAnalyses.mock.calls.length

    fireEvent.click(await screen.findByTestId('app-notice-action'))

    await waitFor(() => expect(loadCachedAnalyses.mock.calls.length).toBeGreaterThan(before))
    expect(loadCachedAnalyses.mock.calls.at(-1)?.[0]).toEqual(['/music/a.wav'])
  })

  // Removing a row takes it out of the quality sweep for good, so a row Undo brought back
  // was skipped by Analyze all and counted as measured with no verdict ever shown.
  it('measures a row Undo brought back when Analyze all runs', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    await addOneTrack()
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    fireEvent.click(await screen.findByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(within(screen.getByTestId('track-row')).queryByTestId('track-quality')).toBeNull()

    runMenu('analyze-quality')

    await waitFor(() =>
      expect(
        within(screen.getByTestId('track-row')).getByTestId('track-quality'),
      ).toBeInTheDocument(),
    )
  })

  // A row can be removed mid-conversion. The job's last write targets a row that is gone,
  // so without carrying it onto the held row, Undo brought back a row busy for the session
  // that Convert skipped and Convert all left out.
  it('brings back a row removed mid-conversion as converted once its job finished', async () => {
    let finish: (r: { outputPath: string; inPlace: boolean }) => void = () => {}
    const processTrack = vi.fn(
      () => new Promise<{ outputPath: string; inPlace: boolean }>((r) => (finish = r)),
    )
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    await addOneTrack()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    await act(async () => finish({ outputPath: '/out/a.aiff', inPlace: false }))

    fireEvent.click(await screen.findByTestId('app-notice-action'))

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(within(screen.getByTestId('track-row')).queryByTestId('track-status-badge')).toBeNull()
    fireEvent.click(screen.getByTestId('track-row'))
    expect(await screen.findByTestId('done-more')).toBeInTheDocument()
  })

  // Undone before the job ends, the row comes back still converting and the job's own last
  // write lands on it like on any row in the list.
  it('lets a row restored mid-conversion finish as converted', async () => {
    let finish: (r: { outputPath: string; inPlace: boolean }) => void = () => {}
    const processTrack = vi.fn(
      () => new Promise<{ outputPath: string; inPlace: boolean }>((r) => (finish = r)),
    )
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
    })
    await renderApp()
    await addOneTrack()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalledTimes(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    fireEvent.click(await screen.findByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    await act(async () => finish({ outputPath: '/out/a.aiff', inPlace: false }))

    await waitFor(() =>
      expect(
        within(screen.getByTestId('track-row')).queryByTestId('track-status-badge'),
      ).toBeNull(),
    )
    fireEvent.click(screen.getByTestId('track-row'))
    expect(await screen.findByTestId('done-more')).toBeInTheDocument()
  })

  // The header button and the palette share one name, "Clear the list", so they must share
  // one scope: what the DJ sees. A filtered view that the palette wiped entirely would take
  // rows the DJ had hidden, not rows they had decided to drop.
  it('clears only the visible rows from the palette, like the header button', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), {
      target: { value: 'Clear the list' },
    })
    fireEvent.click(screen.getByTestId('palette-item'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-row')).toHaveTextContent('WAV')
  })
})

describe('App keyboard navigation', () => {
  // Arrow keys step the selection through the visible rows, moving DOM focus with it
  // so the native focus ring follows the keyboard instead of the last click.
  it('moves the selection and focus to the next row on ArrowDown', async () => {
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })

    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'))
    expect(rows[1]).toHaveFocus()
  })

  // After Shift+↓ the user is at the bottom of the range; a plain ↓ must continue from there,
  // like Finder and Music, not jump back to the row under where the range started.
  it('moves a plain ArrowDown on from the focused end of a Shift-extended range', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.keyDown(rows[0], { key: 'ArrowDown', shiftKey: true })
    await waitFor(() => expect(rows[1]).toHaveFocus())

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })

    await waitFor(() => expect(rows[2]).toHaveAttribute('aria-selected', 'true'))
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
    expect(rows[2]).toHaveFocus()
  })

  // The remove shortcut used to drop the focus on the floor, so the next ↓ restarted from
  // the top of a 400-track list. Like plain ⌫ on a row, the next row takes over.
  it('keeps the place in the list after the remove shortcut', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])

    fireEvent.keyDown(window, { key: 'Backspace', ctrlKey: true })

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    await waitFor(() => expect(rows[1]).toHaveFocus())
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })
    await waitFor(() => expect(rows[2]).toHaveAttribute('aria-selected', 'true'))
  })

  // Auditioning a crate one by one, the DJ wants to see how far along they are: the
  // x/total counter follows the arrow keys.
  it('shows the selected track position and follows navigation', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('track-position')).toHaveTextContent('1/2')

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })

    await waitFor(() => expect(screen.getByTestId('track-position')).toHaveTextContent('2/2'))
  })
})

describe('App continuous playback', () => {
  // With the mode on, a finished track hands off to the next visible row so a queued
  // crate plays through unattended — the same advance the arrow keys make.
  it('advances to the next track when one finishes', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ continuousPlayback: true })) })
    await renderApp()
    const rows = await addTwoTracks()
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')

    const audio = document.querySelector('audio')
    if (!audio) throw new Error('expected the player audio element')
    fireEvent(audio, new Event('ended'))

    await waitFor(() => expect(rows[1]).toHaveAttribute('aria-selected', 'true'))
  })

  // With the mode off, finishing a track leaves the selection put rather than
  // rolling into the next one.
  it('leaves the selection put when continuous playback is off', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ continuousPlayback: false })) })
    await renderApp()
    const rows = await addTwoTracks()

    const audio = document.querySelector('audio')
    if (!audio) throw new Error('expected the player audio element')
    fireEvent(audio, new Event('ended'))

    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
  })
})

describe('App editor prop stability', () => {
  // Typing in the sidebar search filters the list; none of the editor's inputs change,
  // so the memoized editor subtree must not re-render per keystroke — that's the whole
  // point of keeping its props identity-stable.
  it('keeps the editor props stable while typing in the search box', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await screen.findByTestId('field-title')

    const before = editorRenders.count
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'zz' } })
    expect(editorRenders.count).toBe(before)
  })

  // Dragging the results border resizes the columns every animation frame. Only the column
  // width moves; re-rendering the whole editor (form, waves, every section) per frame made
  // the drag stutter.
  it('keeps the editor props stable while the results column border is dragged', async () => {
    const initialWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 })
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await screen.findByTestId('field-title')
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    try {
      const column = screen.getByTestId('matches-column')
      const width = () => screen.getByRole('main').style.getPropertyValue('--results-width')
      const was = width()
      const border = column.nextElementSibling as HTMLElement
      const at = (event: Event, clientX: number): Event =>
        Object.defineProperty(event, 'clientX', { value: clientX })
      const before = editorRenders.count
      fireEvent(border, at(createEvent.pointerDown(border), 700))
      fireEvent(window, at(createEvent.pointerMove(window), 640))
      act(() => {
        for (const frame of frames.splice(0)) frame(0)
      })
      expect(editorRenders.count).toBe(before)
      expect(width()).not.toBe(was)
      fireEvent(window, at(createEvent.pointerUp(window), 640))
    } finally {
      vi.unstubAllGlobals()
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth })
    }
  })
})

describe('App derived list stability', () => {
  // The triage pipeline (quality filter + search match + sort) is memoized on the
  // tracks view. A render that changes neither tracks nor spectra — opening a modal,
  // a progress counter tick — must not re-run it: on a big crate that pipeline is an
  // O(n log n) scan paid on every keystroke and sweep event otherwise.
  it('does not re-run the list sort on a render that changes no track data', async () => {
    await renderApp()
    await addTwoTracks()
    // Let pending meta reads (tags/duration/cover) settle so their setTracks renders
    // are behind us before sampling the baseline.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    const before = sortRuns.count
    runMenu('find-replace')
    await screen.findByTestId('find-replace-find')
    expect(sortRuns.count).toBe(before)
  })

  // Picking a row and moving the pointer over the list are the most frequent things a DJ
  // does while auditioning a crate. Neither changes what the list holds or how it sorts, so
  // neither may pay for filtering and sorting the whole crate again.
  it('does not re-run the list sort when the selection changes or the pointer crosses the list', async () => {
    await renderApp()
    await addTwoTracks()
    // Each row's first pick loads its analyses, which do change what the list sorts on;
    // visit both first so the measured picks change nothing but the selection.
    const pick = async (i: number): Promise<void> => {
      fireEvent.click(screen.getAllByTestId('track-row')[i])
      await waitFor(() =>
        expect(screen.getAllByTestId('track-row')[i]).toHaveAttribute('aria-selected', 'true'),
      )
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50))
      })
    }
    await pick(1)
    await pick(0)
    const before = sortRuns.count
    await pick(1)
    fireEvent.pointerEnter(screen.getByTestId('track-list-scroll'))
    fireEvent.pointerLeave(screen.getByTestId('track-list-scroll'))
    expect(sortRuns.count).toBe(before)
  })

  // TrackList itself is memo'd (see TrackList.tsx), which only pays off if every
  // prop App hands it — onRemove/onTrash included, both built from menuTargets —
  // keeps one identity across an unrelated render. A find/replace modal touches
  // none of the visible tracks, so it must skip re-rendering (and re-mapping every
  // row of) the list entirely.
  it('keeps the track list stable while an unrelated modal opens', async () => {
    await renderApp()
    await addTwoTracks()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      await new Promise(requestAnimationFrame)
    })
    const before = trackListRenders.count
    runMenu('find-replace')
    await screen.findByTestId('find-replace-find')
    expect(trackListRenders.count).toBe(before)
  })
})

describe('App bulk scope in Find & Replace', () => {
  // Overlays derives the scope from which list App handed it; a multi-selection must read
  // as "selected", or the modal claims the visible list while rewriting only two rows.
  it('says it acts on the selection when several tracks are selected', async () => {
    await renderApp()
    const [first, second] = await addTwoTracks()
    fireEvent.click(first)
    fireEvent.click(second, { metaKey: true })
    runMenu('find-replace')
    expect(await screen.findByTestId('find-replace-scope')).toHaveTextContent(
      'Applies to the 2 selected tracks',
    )
  })

  it('says it acts on the visible tracks with one or no track selected', async () => {
    await renderApp()
    await addTwoTracks()
    runMenu('find-replace')
    expect(await screen.findByTestId('find-replace-scope')).toHaveTextContent(
      'Applies to the 2 visible tracks',
    )
  })
})

describe('App sort direction', () => {
  // An album dropped in file-name order is out of its running order; artexjay asked to read
  // the list as the record plays.
  it('lists the tracks in album order when sorted by track number', async () => {
    setApi({
      readTags: vi.fn(async (path: string) =>
        path.endsWith('a.wav')
          ? { ...emptyMetadata(), title: 'Second', trackNumber: '2' }
          : { ...emptyMetadata(), title: 'First', trackNumber: '1' },
      ),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-row')[0]).toHaveTextContent('Second'))
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-trackNumber'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')[0]).toHaveTextContent('First'))
  })

  // The playlist's own order has no direction to flip. A toggle that came and went with the
  // sort shifted the bar under the pointer; it holds its place, off, and says when it applies.
  it('keeps the direction toggle in place but off for the playlist order, saying why', async () => {
    await renderApp()
    await addTwoTracks()
    const toggle = screen.getByTestId('track-sort-direction')
    expect(toggle).toBeDisabled()
    expect(hoverTooltip(toggle)).toBe(i18n.t('sidebar.sort.directionNeedsField'))
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-name'))
    expect(toggle).toBeEnabled()
    // The hint comes from the themed Tooltip, not a native title — so the control reads
    // the same as the rest of the app and tracks the theme.
    expect(toggle).not.toHaveAttribute('title')
  })

  it('flips between ascending and descending when the toggle is pressed', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-name'))
    const toggle = screen.getByTestId('track-sort-direction')
    // Ascending is the default a freshly-picked sort starts on.
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  // A toggle speaks its state through aria-pressed, so its name must hold still: with the
  // label swapping too, a screen reader heard "Ascending order, not pressed", which
  // reads as the opposite of the order on screen.
  it('keeps one name on the direction toggle and lets aria-pressed carry the state', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('track-sort'))
    fireEvent.click(screen.getByTestId('track-sort-option-name'))
    const toggle = screen.getByTestId('track-sort-direction')
    const name = i18n.t('sidebar.sort.descending')
    expect(toggle).toHaveAccessibleName(name)
    fireEvent.click(toggle)
    expect(toggle).toHaveAccessibleName(name)
  })
})

describe('App lazy preload', () => {
  it('schedules the preload once the first rows of the library are in', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    idlePreload.calls = 0
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await waitFor(() => expect(idlePreload.calls).toBeGreaterThan(0))
  })

  it('does not schedule the preload while the library is empty', async () => {
    idlePreload.calls = 0
    await renderApp()
    await screen.findByTestId('add-files')
    expect(idlePreload.calls).toBe(0)
  })
})

describe('App per-format filter', () => {
  // Drops the wav + mp3 pair the format cases lean on (both unconverted, distinct formats).
  async function addMixedCrate(): Promise<void> {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  // The format axis ANDs with the primary bucket instead of replacing it: narrowing to a
  // primary, then to a format, refines the already-filtered set rather than resetting it.
  it('combines a primary bucket with a format, narrowing to their intersection', async () => {
    await addMixedCrate()
    // Both tracks are unconverted, so the primary alone keeps the pair…
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-status'))
    fireEvent.click(screen.getByTestId('quality-filter-unconverted'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // …then reopening and layering the WAV format narrows it to just the wav, the conversion
    // axis still applied (each pick closes the menu, so the second needs a fresh open).
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:WAV'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // The format axis is scoped to the current crate, so when its format leaves the list it
  // must fall back to every format rather than strand the user on an empty refinement
  // (unlike the deliberately-sticky Apple Music buckets).
  it('falls back to every format when the filtered format is no longer present', async () => {
    await addMixedCrate()
    // Narrow to just the MP3.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    // The crate is now WAV-only: had the format filter stayed on MP3 the WAV row would be
    // hidden (0 rows). Seeing it proves the format filter reset.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  it('leaves text still in a field alone when the format filter resets on its own', async () => {
    await addMixedCrate()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getByTestId('track-row'))
    const flush = vi.fn()
    const release = holdPendingEdit(flush)
    fireEvent.click(screen.getByTestId('track-menu-remove'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    release()
    expect(flush).toHaveBeenCalledTimes(1)
  })

  // The bug a DJ hit: filter to one format (MP3), press "Empty" expecting only those gone,
  // and the hidden WAV/FLAC rows vanish too. Empty must honour the active filter and drop
  // only the visible rows, leaving the ones the filter is hiding on disk-and-in-list.
  it('empties only the visible rows when a format filter is active', async () => {
    await addMixedCrate()
    // Narrow to MP3 — only the mp3 row shows.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('remove-all')
    // The mp3 is gone. The format axis, now MP3-less, falls back to every format, so the wav
    // that was hidden behind the filter shows — proof Empty didn't sweep it in. Had Empty
    // cleared the whole list, no row would remain.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-row')).toHaveTextContent('WAV')
  })

  // Find & Replace overwrites tags, so it too must honour the filter: with MP3 shown, the
  // preview (and the apply) covers only the visible mp3, not the hidden wav — otherwise a
  // cleanup pass would silently rewrite rows the user filtered out of view.
  it('scopes Find & Replace to the visible rows when a format filter is active', async () => {
    await addMixedCrate()
    // Both rows share artist 'A'; unscoped, a replace on 'A' would hit both.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('find-replace')
    fireEvent.change(await screen.findByTestId('find-replace-find'), { target: { value: 'A' } })
    fireEvent.change(screen.getByTestId('find-replace-replace'), { target: { value: 'Z' } })
    // The preview counts one track — the visible mp3 — not the two-track crate.
    expect(screen.getByTestId('find-replace-apply')).toHaveTextContent('1')
  })
})

describe('App filter selection', () => {
  // A filter that hides the selected track (here the format axis, which used not to react)
  // must drop the selection onto the first row the new view shows — otherwise the list sits
  // with nothing visibly selected and the editor lingers on an off-screen track.
  it('moves the selection to the first visible track when the format filter hides the selected one', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    // Import auto-selects the first row (the wav). Filtering to MP3 hides it…
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    // …so the lone remaining row (the mp3) becomes the selected one.
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('never renders the list with the editor still on a track the new filter hides', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    trackListRenders.shown = []
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'true')
    const stranded = trackListRenders.shown.filter(
      (r) => r.selectedId !== null && !r.ids.includes(r.selectedId),
    )
    expect(stranded).toEqual([])
  })

  it('keeps text typed into a track on that track when the filter hides it and the selection moves', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn(async (path: string) => ({
        title: path.endsWith('a.wav') ? 'Alpha' : 'Bravo',
        artist: 'DJ',
      })),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha'))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Typed Name' } })
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Bravo'))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Typed Name'))
  })
})

describe('App select all', () => {
  // One control, two jobs: select-all selects every track, and pressing it again once they
  // are all selected clears the selection instead of pointlessly re-selecting the same set.
  it('toggles between selecting every track and clearing the selection', async () => {
    await renderApp()
    await addTwoTracks()
    runMenu('select-all')
    let rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    runMenu('select-all')
    rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'false')
    expect(rows[1]).toHaveAttribute('aria-selected', 'false')
  })

  // The bug a DJ hit: filter to one format (MP3), press Select All expecting only those, then
  // convert — and the hidden FLAC/WAV rows convert too. Select All must honour the active
  // filter and select only the visible rows, never the ones the filter is hiding. Two MP3s so
  // Select All has more than the one already-selected row to grab (and isn't a clear-toggle).
  it('selects only the visible rows when a format filter is active', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3', '/music/c.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    // Narrow to MP3 — only the two mp3 rows show.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-format'))
    fireEvent.click(screen.getByTestId('quality-filter-ext:MP3'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('select-all')
    // Both visible mp3 rows are selected; the hidden wav is not swept in.
    let rows = screen.getAllByTestId('track-row')
    expect(rows[0]).toHaveAttribute('aria-selected', 'true')
    expect(rows[1]).toHaveAttribute('aria-selected', 'true')
    // Clearing the filter reveals all three: exactly the two mp3s stay selected. Had Select
    // All grabbed the hidden wav too, all three would read selected here.
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-clear'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    rows = screen.getAllByTestId('track-row')
    const selected = rows.filter((r) => r.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(2)
  })
})

describe('App donate nudge', () => {
  afterEach(() => vi.restoreAllMocks())

  // Settles pending settings promises before the test ends, so no setSettings
  // lands after restoreAllMocks has reset the matchMedia stub.
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

  function eligible(over: Partial<Settings> = {}): Settings {
    return settings({ conversionCount: 50, firstConversionAt: '2026-01-01T00:00:00.000Z', ...over })
  }

  // An eligible profile that just converted a selection: the nudge rides that moment of
  // value (not app launch), so a successful run is what reveals it. The convert path
  // produces a real output, the api returns the eligible profile both at load and on the
  // re-read, and the draw is forced to land.
  async function convertOnEligibleProfile(over: Record<string, unknown> = {}): Promise<void> {
    setApi({
      getSettings: vi.fn().mockResolvedValue(eligible()),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false }),
      ...over,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('process-btn'))
  }

  // The nudge moved off app launch onto the moment of value: opening Surco is when the
  // user wants to work, not be asked for money. An eligible profile that just launched
  // and hasn't converted anything yet must see nothing, even when the draw would land.
  it('does not appear on launch before any conversion', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    setApi({ getSettings: vi.fn().mockResolvedValue(eligible()) })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
  })

  // After a conversion lands, the occasional "what Surco saved you" summary appears — and
  // the showing is stamped immediately, so the cooldown holds even if the app quits right
  // after. The count reads the re-read profile, so it reflects the conversion just done.
  it('shows the stats summary after a conversion when the draw lands and stamps the showing', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    const saveSettings = vi.fn().mockResolvedValue(eligible())
    await convertOnEligibleProfile({ saveSettings })
    expect(await screen.findByTestId('donate-nudge-count')).toHaveTextContent('50')
    expect(saveSettings).toHaveBeenCalledWith({ donateNudgeLastShown: expect.any(String) })
    await flush()
  })

  // Converting the selected track through the process-current shortcut (mod+Enter) is the
  // same moment of value as the Editor's convert button, so it must reveal the nudge too —
  // otherwise a keyboard user converting one track at a time would never see it.
  it('shows the nudge after a single convert via the process-current shortcut', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    setApi({
      getSettings: vi.fn().mockResolvedValue(eligible()),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack: vi.fn().mockResolvedValue({ outputPath: '/out/x.aiff', inPlace: false }),
      saveSettings: vi.fn<Api['saveSettings']>().mockResolvedValue(eligible()),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByTestId('donate-nudge-count')).toHaveTextContent('50')
    await flush()
  })

  // "No volver a mostrar" is a promise: ticking it must persist, not just close.
  it('persists the permanent dismissal from the checkbox', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.01)
    const saveSettings = vi.fn().mockResolvedValue(eligible())
    await convertOnEligibleProfile({ saveSettings })
    await screen.findByTestId('donate-nudge-dismiss')
    fireEvent.click(screen.getByTestId('donate-nudge-dismiss'))
    fireEvent.click(screen.getByTestId('donate-nudge-close'))
    expect(saveSettings).toHaveBeenCalledWith({ donateNudgeDismissed: true })
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
    await flush()
  })

  // The other side of "random, every now and then": most conversions show nothing.
  it('stays away when the draw misses', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9)
    await convertOnEligibleProfile()
    await screen.findByTestId('batch-summary')
    expect(screen.queryByTestId('donate-nudge-count')).toBeNull()
    await flush()
  })
})

// A repoint rekordbox could not make leaves its collection on the old file, and the run
// otherwise ends like any successful one. Told only to the log, the DJ found out at the
// gig, loading a track that pointed at a file Surco had replaced.
describe('App rekordbox sync notice', () => {
  async function raise(issue: RekordboxSyncIssue): Promise<HTMLElement> {
    let send: ((issue: RekordboxSyncIssue) => void) | undefined
    setApi({
      dj: djReads({
        rekordbox: {
          onSyncIssue: (cb) => {
            send = cb
            return () => {}
          },
        },
      }),
    })
    await renderApp()
    act(() => send?.(issue))
    return screen.findByTestId('rekordbox-sync-issue')
  }

  it('says the collection was left alone because it is read-only', async () => {
    const toast = await raise({ blocked: 'read-only', ambiguous: [] })
    expect(toast.textContent).toContain('read-only')
  })

  it('names the track the collection holds under more than one entry', async () => {
    const toast = await raise({ ambiguous: ['/music/Artist - Title.wav'] })
    expect(toast.textContent).toContain('Artist - Title.wav')
  })
})

// The same for the Engine DJ library: a row left on the old file loads nothing at the gig.
describe('App Engine DJ sync notice', () => {
  async function raise(issue: RekordboxSyncIssue): Promise<HTMLElement> {
    let send: ((issue: RekordboxSyncIssue) => void) | undefined
    setApi({
      dj: djReads({
        engine: {
          onSyncIssue: (cb) => {
            send = cb
            return () => {}
          },
        },
      }),
    })
    await renderApp()
    act(() => send?.(issue))
    return screen.findByTestId('engine-sync-issue')
  }

  it('says the library was left alone because it could not be backed up', async () => {
    const toast = await raise({ blocked: 'backup-failed', ambiguous: [] })
    expect(toast.textContent).toContain('Engine DJ')
    expect(toast.textContent).toContain('back it up')
  })

  it('names the track the library holds under more than one entry', async () => {
    const toast = await raise({ ambiguous: ['/music/Artist - Title.wav'] })
    expect(toast.textContent).toContain('Artist - Title.wav')
  })
})

describe('App update check failure', () => {
  // A launch check that downloaded an update and a later manual check that failed used to
  // share one toast slot, so the failure replaced "restart to update" and the downloaded
  // version had no way left to install until the next launch.
  it('keeps the ready-to-install toast when a later check fails', async () => {
    let ready: ((version: string) => void) | undefined
    let fail: ((status: number | null) => void) | undefined
    setApi({
      onUpdateDownloaded: (cb: (version: string) => void) => {
        ready = cb
        return () => {}
      },
      onUpdateCheckFailed: (cb: (status: number | null) => void) => {
        fail = cb
        return () => {}
      },
    })
    await renderApp()
    act(() => ready?.('9.9.9'))
    await screen.findByTestId('update')
    act(() => fail?.(504))
    await screen.findByTestId('update-check-failed')
    expect(screen.getByTestId('update')).toBeInTheDocument()
  })

  // The 504 screenshot that motivated this: a failed check used to dump the raw
  // HTTP error (HTML body, headers) into a toast. The user must instead get a short
  // localized line and a Retry button that actually re-runs the check.
  it('shows a clean retry toast when the update check fails', async () => {
    let fail: ((status: number | null) => void) | undefined
    const checkForUpdates = vi.fn().mockResolvedValue(undefined)
    setApi({
      onUpdateCheckFailed: (cb: (status: number | null) => void) => {
        fail = cb
        return () => {}
      },
      checkForUpdates,
    })
    await renderApp()
    act(() => fail?.(504))
    const toast = await screen.findByTestId('update-check-failed')
    expect(toast.textContent).toContain('Could not check for updates')
    expect(toast.textContent).toContain('504')
    expect(toast.textContent).not.toContain('<html>')
    fireEvent.click(screen.getByTestId('update-check-failed-action'))
    expect(checkForUpdates).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.queryByTestId('update-check-failed')).not.toBeInTheDocument())
  })

  // The launch check can fail before the settings apply the user's language, so the
  // card must read in whatever language is current when it is on screen.
  it('follows a language change made while the failure card is up', async () => {
    let fail: ((status: number | null) => void) | undefined
    setApi({
      onUpdateCheckFailed: (cb: (status: number | null) => void) => {
        fail = cb
        return () => {}
      },
    })
    try {
      await renderApp()
      act(() => fail?.(null))
      await screen.findByTestId('update-check-failed')
      await act(async () => {
        await i18n.changeLanguage('es')
      })
      expect(screen.getByTestId('update-check-failed-message')).toHaveTextContent(
        'No se pudo comprobar si hay actualizaciones',
      )
      expect(screen.getByTestId('update-check-failed-action')).toHaveTextContent('Reintentar')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })

  it('follows a language change made while the update-ready card is up', async () => {
    let ready: ((version: string) => void) | undefined
    setApi({
      onUpdateDownloaded: (cb: (version: string) => void) => {
        ready = cb
        return () => {}
      },
    })
    try {
      await renderApp()
      act(() => ready?.('9.9.9'))
      await screen.findByTestId('update')
      await act(async () => {
        await i18n.changeLanguage('es')
      })
      expect(screen.getByTestId('update-message')).toHaveTextContent('La versión 9.9.9 está lista')
      expect(screen.getByTestId('update-action')).toHaveTextContent('Reiniciar')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })
})

describe("App what's new popup", () => {
  const flush = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

  // The point of the feature: an update announces exactly what it shipped — the 0.33.0
  // item was already seen, only the 0.33.1 one is news. The running version is stamped
  // immediately so the popup fires once per update, never on every launch.
  it('shows only the unseen items after an update and stamps the running version', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi.fn().mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.0' })),
      saveSettings,
    })
    await renderApp()
    expect(await screen.findByText('Arreglo del análisis a 48 kHz.')).toBeInTheDocument()
    expect(screen.queryByText('Popup de novedades tras actualizar.')).toBeNull()
    expect(saveSettings).toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
    await flush()
  })

  // The stamp used to be a fire-and-forget write: on failure the UI stayed silent and
  // the popup would fire again next launch. Routed through the same save path as every
  // other settings write, a failure surfaces the persistent error card.
  it('surfaces the error card when stamping the changelog version fails', async () => {
    setApi({
      version: '0.33.1',
      getSettings: vi.fn().mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.0' })),
      saveSettings: vi.fn().mockRejectedValue(new Error('disk full')),
    })
    await renderApp()
    expect(await screen.findByTestId('app-error')).toBeInTheDocument()
    await flush()
  })

  // A fresh install has nothing to announce (onboarding owns that launch), but the
  // version is still stamped silently — otherwise the second launch would "discover"
  // the current changelog and pop it at a user who didn't update anything.
  it('stays silent on a fresh install but stamps the version for the next update', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ hasSeenOnboarding: false, lastSeenChangelogVersion: '' })),
      saveSettings,
    })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('whats-new-close')).toBeNull()
    expect(saveSettings).toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
  })

  // Same version, same launch as always: nothing to show, nothing to write.
  it('does nothing when the running version was already seen', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      version: '0.33.1',
      getSettings: vi.fn().mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.1' })),
      saveSettings,
    })
    await renderApp()
    await flush()
    expect(screen.queryByTestId('whats-new-close')).toBeNull()
    expect(saveSettings).not.toHaveBeenCalledWith({ lastSeenChangelogVersion: '0.33.1' })
  })

  // The release histories are the heaviest data the app ships. A launch with nothing
  // new to announce — the everyday launch — must not load one just to find that out.
  it('loads no changelog when the running version was already seen', async () => {
    const before = changelogLoads.count
    setApi({
      version: '0.33.1',
      getSettings: vi.fn().mockResolvedValue(settings({ lastSeenChangelogVersion: '0.33.1' })),
      saveSettings: vi.fn().mockResolvedValue(settings()),
    })
    await renderApp()
    await flush()
    expect(changelogLoads.count).toBe(before)
  })

  // Onboarding owns a fresh install's launch, so there is no news to look up either.
  it('loads no changelog on a fresh install', async () => {
    const before = changelogLoads.count
    setApi({
      version: '0.33.1',
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ hasSeenOnboarding: false, lastSeenChangelogVersion: '' })),
      saveSettings: vi.fn().mockResolvedValue(settings()),
    })
    await renderApp()
    await flush()
    expect(changelogLoads.count).toBe(before)
  })
})

describe('App offers the rekordbox Playlists field', () => {
  it('offers it once settings (onboarding seen) and availability arrive, appended to the shown fields', async () => {
    const saveSettings = vi
      .fn()
      .mockResolvedValue(settings({ rekordboxPlaylistsFieldOffered: true }))
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ rekordboxPlaylistsFieldOffered: false, visibleFields: ['title'] }),
        ),
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
      saveSettings,
    })
    await renderApp()
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        visibleFields: ['title', 'rekordboxPlaylists'],
        rekordboxPlaylistsFieldOffered: true,
      }),
    )
  })

  it('waits for onboarding to finish, because the wizard would overwrite the offered fields with its own draft', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ hasSeenOnboarding: false, rekordboxPlaylistsFieldOffered: false }),
        ),
      dj: djReads({
        rekordbox: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
      saveSettings,
    })
    await renderApp()
    await waitFor(() => expect(window.api.dj.available).toHaveBeenCalledWith('rekordbox'))
    await act(async () => {})
    expect(saveSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ rekordboxPlaylistsFieldOffered: true }),
    )
  })
})

describe('App offers the playlists field of each program Surco adds converted tracks to', () => {
  it('offers the Serato crates field once Serato is found, since Surco adds converted tracks to its crates', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ seratoPlaylistsFieldOffered: false, visibleFields: ['title'] }),
        ),
      dj: djReads({
        serato: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
      saveSettings,
    })
    await renderApp()
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        visibleFields: ['title', 'seratoPlaylists'],
        seratoPlaylistsFieldOffered: true,
      }),
    )
  })

  it('offers the VirtualDJ lists field once VirtualDJ is found, since Surco adds converted tracks to its lists', async () => {
    const saveSettings = vi.fn().mockResolvedValue(settings())
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ virtualdjPlaylistsFieldOffered: false, visibleFields: ['title'] }),
        ),
      dj: djReads({
        virtualdj: { available: vi.fn<ProgramReads['available']>().mockResolvedValue(true) },
      }),
      saveSettings,
    })
    await renderApp()
    await waitFor(() =>
      expect(saveSettings).toHaveBeenCalledWith({
        visibleFields: ['title', 'virtualdjPlaylists'],
        virtualdjPlaylistsFieldOffered: true,
      }),
    )
  })
})

describe('App Apple Music library filter', () => {
  // The whole point of the filter: after importing a crate, the user wants to see only
  // the tracks they don't already own in Apple Music, so they don't re-import duplicates.
  // The library snapshot is matched against the crate locally, the two buckets get their
  // chips, and the "not in library" chip narrows the list to the ones still worth adding.
  it('matches imported tracks against the library and filters down to the ones not yet owned', async () => {
    setApi({
      // The library snapshot and the per-track lookup are macOS-only, and the check
      // only runs while Apple Music is the conversion destination.
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(settings({ addToAppleMusic: true })),
      readTags: vi.fn((path: string) =>
        Promise.resolve(
          path.includes('a.wav')
            ? { artist: 'deadmau5', title: 'Strobe' }
            : { artist: 'deadmau5', title: 'Ghosts' },
        ),
      ),
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }]),
    })
    await renderApp()
    await addTwoTracks()
    // Both tracks get a verdict from the snapshot, so both library buckets list in the
    // filter menu: one owned (Strobe), one missing (Ghosts).
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-library'))
    const notInLibrary = await screen.findByTestId('quality-filter-notInLibrary')
    expect(screen.getByTestId('quality-filter-inLibrary')).toBeInTheDocument()
    // Filtering to "not in library" leaves only the track the library doesn't hold.
    fireEvent.click(notInLibrary)
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
  })

  // A library Music refused to hand over leaves every row without a verdict, which looked
  // exactly like a check still loading: no badge, no filter buckets, nothing said.
  it('says so when the library could not be read', async () => {
    setApi({
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(settings({ addToAppleMusic: true })),
      readTags: vi.fn().mockResolvedValue({ artist: 'deadmau5', title: 'Strobe' }),
      loadAppleMusicLibrary: vi.fn().mockRejectedValue(new Error('Music got an error (-1728)')),
    })
    await renderApp()
    await addTwoTracks()
    expect((await screen.findByTestId('library-check-failed')).textContent).toContain('Apple Music')
  })

  // Off macOS there is no library to read, so a Windows build shows no Apple Music section
  // in the menu at all.
  it('lists no library section off macOS', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ artist: 'deadmau5', title: 'Strobe' }),
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }]),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    expect(screen.queryByTestId('quality-filter-section-library')).toBeNull()
  })

  // "Better than Music" weighs a file brought in against the copy Music already holds. A DJ
  // program's playlist, or Music's own, is the library itself: nothing there was brought in.
  function withRekordbox(): void {
    setApi({
      platform: 'darwin',
      getSettings: vi.fn().mockResolvedValue(settings({ addToAppleMusic: true })),
      readTags: vi.fn().mockResolvedValue({ artist: 'deadmau5', title: 'Strobe' }),
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }]),
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 2 }]),
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([
            { path: '/m/c.wav', separator: false, meta: {}, contentId: '41' },
            { path: '/m/d.wav', separator: false, meta: {}, contentId: '42' },
          ]),
        },
      }),
      cues: {
        trackCues: vi.fn<Api['cues']['trackCues']>().mockResolvedValue(null),
      },
    })
  }

  async function openFactory(): Promise<void> {
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  }

  it('offers Better than Music on the Tracks tab only', async () => {
    withRekordbox()
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-library'))
    expect(await screen.findByTestId('quality-filter-betterThanLibrary')).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await openFactory()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-library'))
    expect(await screen.findByTestId('quality-filter-inLibrary')).toBeInTheDocument()
    expect(screen.queryByTestId('quality-filter-betterThanLibrary')).toBeNull()
  })

  // Left on, it would hide every row of the playlist behind a filter its menu no longer lists.
  it('drops Better than Music on leaving the Tracks tab', async () => {
    withRekordbox()
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-library'))
    fireEvent.click(await screen.findByTestId('quality-filter-betterThanLibrary'))
    await waitFor(() =>
      expect(screen.getByTestId('quality-filter-trigger')).toHaveTextContent(/Better than Music/),
    )
    await openFactory()
    expect(screen.getByTestId('quality-filter-trigger')).not.toHaveTextContent(/Better than Music/)
  })
})

describe('App metadata undo', () => {
  // Batch tag operations are one keystroke away (⌘E clears the whole selection) and used
  // to be unrecoverable — a slip destroyed hand-typed or Discogs-applied work. ⌘Z must
  // bring back exactly what the clear wiped and confirm it did, so the user knows the
  // slip was absorbed rather than wondering what state the crate is in.
  it('restores cleared metadata with the undo shortcut and confirms it', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title')

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('')

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Imported Title')
    expect(screen.getByText('Metadata restored on 1 track')).toBeInTheDocument()
  })

  // Reviewed's notice says what ⌘Z would take back. While it is up, ⌘Z belongs to it: falling
  // through to an older tag edit would silently change tags the DJ was not even looking at.
  it('⌘Z undoes Reviewed while its notice is up, before older tag edits', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    expect(await screen.findByTestId('field-title')).toHaveValue('Imported Title')
    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('field-title')).toHaveValue('')
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undoReviewed).toHaveBeenCalledOnce()
    expect(screen.getByTestId('field-title')).toHaveValue('')
    takeShortcutUndo()
  })

  // A tag notice's Undo names the tag edit on its card. Taking back a Reviewed from another
  // notice instead would bring a track back to To review and leave the tags wiped.
  it('undoes the tags from a tag notice even while Reviewed still offers its undo', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)

    fireEvent.click(await screen.findByTestId('clear-meta-btn'))
    fireEvent.click(await screen.findByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Imported Title'))
    expect(undoReviewed).not.toHaveBeenCalled()
    takeShortcutUndo()
  })

  // ⌘Z means the newest notice. A tag edit made after Reviewed is what the DJ just did, so
  // ⌘Z takes back the tags, not the older Reviewed underneath.
  it('gives ⌘Z to a newer tag notice over an older Reviewed', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)

    fireEvent.click(await screen.findByTestId('clear-meta-btn'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue(''))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Imported Title'))
    expect(undoReviewed).not.toHaveBeenCalled()
    takeShortcutUndo()
  })

  // A tag edit with no notice of its own is still the DJ's newest step: ⌘Z after it takes
  // back the edit, not an older Reviewed they are no longer looking at.
  it('gives ⌘Z to a tag edit made after Reviewed even when the edit shows no notice', async () => {
    setApi({ readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }) })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getAllByTestId('track-row')[1], { shiftKey: true })
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)

    const artist = await screen.findByTestId('field-artist')
    fireEvent.change(artist, { target: { value: 'Someone Else' } })
    fireEvent.blur(artist)
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue('Someone Else'))
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue('Artist'))
    expect(undoReviewed).not.toHaveBeenCalled()
    takeShortcutUndo()
  })

  // The trim summary is an undo notice too. Pushed after Reviewed it is what the DJ just did,
  // so ⌘Z must no longer reach the older Reviewed underneath.
  it('lets a newer trim notice take ⌘Z from an older Reviewed', async () => {
    const peaks = Array.from({ length: 200 }, (_, i) => (i >= 20 && i < 180 ? 0.3 : 0.0005))
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
      waveform: vi.fn().mockResolvedValue({ peaks, rms: peaks, durationSec: 100 }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    const undoReviewed = vi.fn()
    offerShortcutUndo(undoReviewed)

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    await screen.findByTestId('palette-input')
    const option = document.getElementById('palette-option-trim-detected')
    expect(option).not.toBeNull()
    if (option) fireEvent.click(option)
    expect(await screen.findByText(i18n.t('notices.trimApplied', { count: 1 }))).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    expect(undoReviewed).not.toHaveBeenCalled()
    takeShortcutUndo()
  })

  it('keeps a title typed after a clear when the clear is undone, bringing back only what the clear wiped', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    expect(await screen.findByTestId('field-artist')).toHaveValue('Artist')

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    expect(screen.getByTestId('field-artist')).toHaveValue('')
    const title = screen.getByTestId('field-title')
    fireEvent.change(title, { target: { value: 'Typed Title' } })
    fireEvent.blur(title)

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('field-artist')).toHaveValue('Artist'))
    expect(screen.getByTestId('field-title')).toHaveValue('Typed Title')
  })

  it('reapplies an undone clear with the redo shortcut and confirms it, so one ⌘Z too many is not a dead end', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    expect(await screen.findByTestId('field-title')).toHaveValue('Imported Title')

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(screen.getByTestId('field-title')).toHaveValue('Imported Title')

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('field-title')).toHaveValue('')
    expect(screen.getByText('Metadata edit redone on 1 track')).toBeInTheDocument()
  })

  // Clearing wipes the artwork alongside the tags (coverRemoved plus coverUrl), so the
  // snapshot has to carry the cover the way paste's does. Without it ⌘Z brought the text
  // back and left the well empty.
  it('restores the artwork when a clear is undone', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi
        .fn()
        .mockResolvedValue({ thumbUrl: 'data:image/jpeg;base64,AA', width: 600, height: 600 }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('clear-meta-btn'))
    await waitFor(() => expect(screen.queryByTestId('cover-preview')).toBeNull())

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())
  })

  // The Eraser wipes every field with one click and its only way back was ⌘Z, which
  // nothing on screen mentioned: the clear now says what it did and offers the undo.
  it('offers an undo right after the Eraser clears a track', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')

    fireEvent.click(await screen.findByTestId('clear-meta-btn'))
    expect(await screen.findByTestId('app-notice-message')).toHaveTextContent(
      i18n.t('notices.clearedMeta', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Imported Title'))
  })

  // Find & Replace rewrites tags across the visible list and records an undo snapshot, but
  // nothing on screen said so: ⌘Z worked for whoever knew it. Like the Eraser, the batch now
  // names what it did and offers the way back.
  it('offers an undo right after Find & Replace rewrites tags', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')

    runMenu('find-replace')
    fireEvent.change(await screen.findByTestId('find-replace-find'), {
      target: { value: 'Imported' },
    })
    fireEvent.change(screen.getByTestId('find-replace-replace'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Changed Title'))
    expect(await screen.findByTestId('app-notice-message')).toHaveTextContent(
      i18n.t('notices.updatedMeta', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Imported Title'))
  })

  // Filling from file names overwrites tags, which used to be asked about first. The explicit
  // command is safe to run at once only because the toast's Undo brings the old values back.
  it('fills tags from the file name at once and Undo restores the previous values', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/Daft Punk - One More Time.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')

    fireEvent.click(screen.getByTestId('list-actions-more'))
    fireEvent.click(screen.getByTestId('fill-all'))

    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('One More Time'))
    expect(await screen.findByTestId('app-notice-message')).toHaveTextContent(
      i18n.t('notices.updatedMeta', { count: 1 }),
    )
    fireEvent.click(screen.getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Imported Title'))
  })

  // The ⌘K clear is the Eraser button's twin and has to clear the same things. It set
  // coverRemoved without dropping coverUrl, so the artwork stayed on screen: the clear
  // read as "it didn't touch the cover" while the conversion was already staged to wipe
  // it, and the undo had no cover recorded to bring back either.
  it('clears the artwork from the command as well as the button', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Imported Title', artist: 'Artist' }),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi
        .fn()
        .mockResolvedValue({ thumbUrl: 'data:image/jpeg;base64,AA', width: 600, height: 600 }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await screen.findByText('Imported Title')
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'e', ctrlKey: true })

    await waitFor(() => expect(screen.queryByTestId('cover-preview')).toBeNull())
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())
  })

  it('takes back a multi-select Eraser clear, tags and artwork together, with a single undo', async () => {
    setApi({
      readTags: vi.fn(async (path: string) => ({
        title: path === '/music/a.wav' ? 'Alpha' : 'Bravo',
        artist: 'Artist',
      })),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi
        .fn()
        .mockResolvedValue({ thumbUrl: 'data:image/jpeg;base64,AA', width: 600, height: 600 }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())
    fireEvent.click(rows[1], { metaKey: true })

    fireEvent.click(await screen.findByTestId('clear-meta-btn'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue(''))
    expect(screen.queryByTestId('cover-preview')).toBeNull()

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    for (const [index, title] of ['Alpha', 'Bravo'].entries()) {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue(title))
      await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())
    }
  })

  // The find & replace modal rewrites text fields across every visible track in one apply;
  // one ⌘Z afterwards must roll the whole sweep back, not just a single row.
  it('rolls back a find & replace sweep across tracks in one undo', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Deep Mix', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    fireEvent.change(await screen.findByTestId('find-replace-find'), { target: { value: 'Deep' } })
    fireEvent.change(screen.getByTestId('find-replace-replace'), { target: { value: 'Dub' } })
    fireEvent.click(screen.getByTestId('find-replace-apply'))
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Dub Mix'),
    )

    // The panel stays open for chained replacements, and global shortcuts are suppressed while
    // a modal is up — so dismissing it is part of reaching undo, exactly as the user would.
    fireEvent.click(screen.getByTestId('find-replace-cancel'))

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Deep Mix')
    expect(screen.getByText('Metadata restored on 2 tracks')).toBeInTheDocument()
  })

  const matchRelease: Release = {
    provider: 'discogs',
    id: 1,
    title: 'Album',
    artists: [{ name: 'Artist' }],
    tracklist: [{ position: '1', title: 'My Song', duration: '3:00' }],
  }

  it('takes back a whole auto-match sweep with one undo, so a wrong batch of matches is one keystroke from gone', async () => {
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ discogsToken: 'tok', visibleFields: ['title', 'artist', 'album'] }),
        ),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      readDuration: vi.fn().mockResolvedValue(180),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue(matchRelease),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-automatched')).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('field-album')).toHaveValue('Album'))

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(screen.queryAllByTestId('track-automatched')).toHaveLength(0))
    expect(screen.getByTestId('field-album')).toHaveValue('')
    expect(screen.getByText('Metadata restored on 2 tracks')).toBeInTheDocument()
  })

  it('puts a review accepted from the row back up for review on undo, tags and all', async () => {
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ discogsToken: 'tok', visibleFields: ['title', 'artist', 'album'] }),
        ),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Another Act - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({
        ...matchRelease,
        artists: [{ name: 'Another Act' }],
        tracklist: [{ position: '1', title: 'My Song' }],
      }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(screen.getByTestId('auto-match'))
    await waitFor(() => expect(screen.getAllByTestId('track-match-review')).toHaveLength(2))
    fireEvent.click(rows[0])

    fireEvent.click(within(rows[0].parentElement as HTMLElement).getByTestId('track-match-review'))
    await waitFor(() => expect(screen.getByTestId('field-album')).toHaveValue('Album'))
    expect(screen.getAllByTestId('track-match-review')).toHaveLength(1)

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(screen.getAllByTestId('track-match-review')).toHaveLength(2))
    expect(screen.getByTestId('field-album')).toHaveValue('')
  })

  it('takes back a release picked in the editor on undo, since the file own tags are otherwise gone', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Own Title', artist: 'Own Artist' }),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({
        ...matchRelease,
        tracklist: [{ position: '1', title: 'Release Title' }],
      }),
    })
    await renderApp()
    await addOneTrack()
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Own Title'))
    fireEvent.change(screen.getByTestId('discogs-query'), { target: { value: 'album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    fireEvent.click(await screen.findByTestId('discogs-result'))
    fireEvent.click((await screen.findAllByTestId('discogs-track'))[0])
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Release Title'))
    ;(document.activeElement as HTMLElement | null)?.blur()

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Own Title'))
    expect(screen.getByTestId('field-artist')).toHaveValue('Own Artist')
  })

  it('takes the release artwork back off every selected track when a release applied across them is undone', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ discogsToken: 'tok' })),
      readTags: vi.fn((path: string) =>
        Promise.resolve({ title: path === '/music/a.wav' ? 'One' : 'Two', artist: 'Artist' }),
      ),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      search: vi.fn().mockResolvedValue([{ id: 1, title: 'Artist - Album' }]),
      getRelease: vi.fn<Api['getRelease']>().mockResolvedValue({
        ...matchRelease,
        images: [{ uri: 'https://img/release.jpg', type: 'primary', resource_url: '' }],
        tracklist: [
          { position: '1', title: 'One' },
          { position: '2', title: 'Two' },
        ],
      }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.change(await screen.findByTestId('discogs-query'), { target: { value: 'album' } })
    fireEvent.keyDown(screen.getByTestId('discogs-query'), { key: 'Enter' })
    fireEvent.click(await screen.findByTestId('discogs-result'))
    fireEvent.click(await screen.findByTestId('match-apply'))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() =>
      expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'https://img/release.jpg'),
    )

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    for (const index of [0, 1]) {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() =>
        expect(screen.getByTestId('field-title')).toHaveValue(['One', 'Two'][index]),
      )
      expect(screen.queryByTestId('cover-preview')).toBeNull()
    }
  })

  it('brings back a cover removed by hand on undo', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi
        .fn()
        .mockResolvedValue({ thumbUrl: 'data:image/jpeg;base64,AA', width: 600, height: 600 }),
    })
    await renderApp()
    await addOneTrack()
    await waitFor(() => expect(screen.getByTestId('cover-preview')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('cover-remove'))
    await waitFor(() => expect(screen.queryByTestId('cover-preview')).toBeNull())

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    await waitFor(() =>
      expect(screen.getByTestId('cover-preview')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,AA',
      ),
    )
  })

  it('keeps a cover picked from disk alive when another replaces it, so undo can show it again', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      await addOneTrack()
      for (const name of ['first.png', 'second.png']) {
        const file = new File(['x'], name, { type: 'image/png' })
        fireEvent.change(await screen.findByTestId('cover-input'), { target: { files: [file] } })
      }
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:second'),
      )

      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:first'),
      )
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:first')
    } finally {
      Object.assign(url, original)
    }
  })

  it('keeps a cover picked from disk alive when a selection-wide pick replaces it, so undo can show it again', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      const rows = await addTwoTracks()
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      for (const name of ['first.png', 'second.png']) {
        const file = new File(['x'], name, { type: 'image/png' })
        fireEvent.change(await screen.findByTestId('cover-input'), { target: { files: [file] } })
      }
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:second'),
      )

      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:first'),
      )
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:first')
    } finally {
      Object.assign(url, original)
    }
  })

  it('keeps a shared cover an undo step still holds alive when the other row showing it is removed, so undo can show it again', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:shared')
      .mockReturnValueOnce('blob:own')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn(async (path: string) => ({
          title: path === '/music/a.wav' ? 'Alpha' : 'Bravo',
          artist: 'Artist',
        })),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      const rows = await addTwoTracks()
      fireEvent.click(rows[0])
      fireEvent.click(rows[1], { metaKey: true })
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'shared.png', { type: 'image/png' })] },
      })
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:shared'),
      )
      fireEvent.change(screen.getByTestId('cover-input'), {
        target: { files: [new File(['x'], 'own.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:own'),
      )

      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(screen.getByTestId('track-menu-remove'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:shared')

      fireEvent.click(screen.getAllByTestId('track-row')[0])
      fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:shared'),
      )
    } finally {
      Object.assign(url, original)
    }
  })

  // The cover the DJ picked lives only as a blob URL in memory, and clearing the list used to
  // free it on the spot. Undo would then bring the row back with its art gone, so the clear
  // holds the blob for as long as its Undo is on offer. The row's own thumbnail stays the
  // file's art, as it was before the clear.
  it('brings a picked cover back when clearing the list is undone', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:picked')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      await addOneTrack()
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'picked.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:picked'),
      )
      expect(within(screen.getByTestId('track-row')).queryByTestId('track-cover')).toBeNull()

      fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
      fireEvent.change(await screen.findByTestId('palette-input'), {
        target: { value: 'Clear the list' },
      })
      fireEvent.click(screen.getByTestId('palette-item'))
      await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:picked')
      fireEvent.click(await screen.findByTestId('app-notice-action'))

      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      fireEvent.click(screen.getByTestId('track-row'))
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:picked'),
      )
      expect(within(screen.getByTestId('track-row')).queryByTestId('track-cover')).toBeNull()
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:picked')
    } finally {
      Object.assign(url, original)
    }
  })

  // Holding the blob for the Undo must not turn into holding it for the session: an
  // unreleased blob URL pins the whole image file in memory until quit. Twenty-one
  // numberings push the pick out of the ⌘Z history, so only the removal's Undo holds it.
  it("holds a removed row's picked cover while its Undo is on offer and frees it after", async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:picked')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      await addTwoTracks()
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'picked.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:picked'),
      )
      for (let i = 0; i <= MAX_META_UNDO; i++) runMenu('number-tracks')
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getByTestId('track-menu-remove'))
        await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:picked')
        act(() => vi.advanceTimersByTime(7000))
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:picked'))
      } finally {
        vi.useRealTimers()
      }
    } finally {
      Object.assign(url, original)
    }
  })

  // When the file came back into the list some other way while Undo was on offer, Undo has
  // no row to put back, so the blob it was holding for that row has nobody left to show it.
  it('frees the held cover of a row Undo cannot put back', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:picked')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      await addTwoTracks()
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'picked.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:picked'),
      )
      for (let i = 0; i <= MAX_META_UNDO; i++) runMenu('number-tracks')
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(screen.getByTestId('track-menu-remove'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      runMenu('add')
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:picked')

      const removal = screen
        .getAllByTestId('app-notice')
        .find((card) => card.textContent?.includes(i18n.t('notices.removedFromList', { count: 1 })))
      if (!removal) throw new Error('no removal toast')
      fireEvent.click(within(removal).getByTestId('app-notice-action'))

      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:picked'))
      expect(screen.getAllByTestId('track-row')).toHaveLength(2)
    } finally {
      Object.assign(url, original)
    }
  })

  // Tidying a crate row by row stacked one Undo card per removal, a wall of toasts where each
  // Undo took back a single row. One card counts them all, and its Undo brings them all back.
  it('gathers removals made in a row into one Undo that brings them all back', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => `/music/t${i}.wav`)
    setApi({
      pickFiles: vi.fn().mockResolvedValue(paths),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(10))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    for (let left = 9; left >= 0; left--) {
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
      fireEvent.click(screen.getByTestId('track-menu-remove'))
      await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(left))
    }
    const removals = screen
      .getAllByTestId('app-notice')
      .filter((card) => card.textContent?.includes('removed from the list'))
    expect(removals).toHaveLength(1)
    expect(removals[0]).toHaveTextContent(i18n.t('notices.removedFromList', { count: 10 }))
    fireEvent.click(within(removals[0]).getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(10))
    await waitFor(() => expect(screen.queryAllByTestId('app-notice')).toHaveLength(0))
  })

  // A removal folded into the live Undo restarts its countdown, so the earlier row's cover must
  // stay held until the shared card goes: freeing it with the replaced card would bring that
  // row back without its art. When the card does go, each blob is freed once.
  it('holds every cover of gathered removals until the shared Undo goes, then frees each once', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first')
      .mockReturnValueOnce('blob:second')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
      })
      await renderApp()
      await addTwoTracks()
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'first.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:first'),
      )
      fireEvent.click(screen.getAllByTestId('track-row')[1])
      fireEvent.change(screen.getByTestId('cover-input'), {
        target: { files: [new File(['x'], 'second.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:second'),
      )
      for (let i = 0; i <= MAX_META_UNDO; i++) runMenu('number-tracks')
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getByTestId('track-menu-remove'))
        await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
        act(() => vi.advanceTimersByTime(4000))
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getByTestId('track-menu-remove'))
        await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
        act(() => vi.advanceTimersByTime(4000))
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:first')
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:second')
        act(() => vi.advanceTimersByTime(3000))
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:second'))
        act(() => vi.advanceTimersByTime(7000))
      } finally {
        vi.useRealTimers()
      }
      expect(revokeObjectURL.mock.calls.filter(([u]) => u === 'blob:first')).toHaveLength(1)
      expect(revokeObjectURL.mock.calls.filter(([u]) => u === 'blob:second')).toHaveLength(1)
    } finally {
      Object.assign(url, original)
    }
  })

  it('gives every selected track its own cover back after one was pasted over all of them', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi.fn((path: string) =>
        Promise.resolve({
          thumbUrl:
            path === '/music/a.wav' ? 'data:image/jpeg;base64,AA' : 'data:image/jpeg;base64,BB',
          width: 600,
          height: 600,
        }),
      ),
      hasClipboardImage: vi.fn().mockResolvedValue(true),
      pasteCoverImage: vi
        .fn()
        .mockResolvedValue({ coverUrl: 'data:image/jpeg;base64,CC', coverPath: '/tmp/cc.jpg' }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    await waitFor(() => expect(within(rows[1]).getByTestId('track-cover')).toBeInTheDocument())
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(await screen.findByTestId('cover-paste'))
    await waitFor(() =>
      expect(screen.getByTestId('cover-preview')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,CC',
      ),
    )

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })

    for (const [index, src] of [
      'data:image/jpeg;base64,AA',
      'data:image/jpeg;base64,BB',
    ].entries()) {
      fireEvent.click(screen.getAllByTestId('track-row')[index])
      await waitFor(() => expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', src))
    }
  })
})

describe('App reopen last session', () => {
  // The app opens empty every launch; someone cleaning the same downloads folder over
  // days re-imported it by hand every time. The launch offer restores the previous
  // list in one click — through the same expand pipeline as a drop, so media access
  // and metadata reads behave exactly like a fresh import.
  it('offers the previous session at launch and loads it on accept', async () => {
    setApi({
      getLastSession: vi
        .fn()
        .mockResolvedValue({ paths: ['/music/a.wav', '/music/b.wav'], edits: {} }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  // Auditioning a crate of 700 over two evenings: the reopen lands on the track the user
  // had reached, not on the first one, or they hunt for their place by ear.
  it('lands on the track that was selected when the session was saved', async () => {
    setApi({
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        paths: ['/music/a.wav', '/music/b.wav', '/music/c.wav'],
        edits: {},
        view: { selectedPath: '/music/b.wav' },
      }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[1]).toHaveAttribute('aria-selected', 'true'),
    )
    expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'false')
  })

  // Two of 718 picked out to convert the next day: the reopen brings both back selected, so
  // "Convert 2" is where it was left instead of a single track.
  it('brings back every track that was selected, not only the open one', async () => {
    setApi({
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        paths: ['/music/a.wav', '/music/b.wav', '/music/c.wav'],
        edits: {},
        view: { selectedPath: '/music/c.wav', selectedPaths: ['/music/a.wav', '/music/c.wav'] },
      }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    await waitFor(() =>
      expect(
        screen.getAllByTestId('track-row').map((row) => row.getAttribute('aria-selected')),
      ).toEqual(['true', 'false', 'true']),
    )
    expect(screen.getByTestId('track-selected-count')).toHaveAccessibleName('2 selected')
  })

  // Accepting must retire the prompt itself: it once stayed up after the click (the
  // toast id ref was cleared before the withdraw effect could use it), so every extra
  // press re-imported the same session and rained "already in the list" notices.
  it('dismisses the offer once accepted', async () => {
    setApi({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.queryByTestId('last-session')).toBeNull())
  })

  // The offer is raised the moment the saved list comes back, which at launch is before
  // the settings apply the user's language: frozen at push time, a DJ who picked Spanish
  // read it in the system's English.
  it('shows the offer in the language the settings apply after it was raised', async () => {
    let loadSettings: (s: Settings) => void = () => {}
    const pending = new Promise<Settings>((resolve) => {
      loadSettings = resolve
    })
    setApi({
      getSettings: vi.fn(() => pending),
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
    })
    try {
      await renderApp()
      await screen.findByTestId('last-session')
      await act(async () => loadSettings(settings({ language: 'es' })))
      await waitFor(() =>
        expect(screen.getByTestId('last-session-message')).toHaveTextContent(
          '¿Reabrir la última sesión? (1 pista)',
        ),
      )
      expect(screen.getByTestId('last-session-action')).toHaveTextContent('Reabrir')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })

  it('stays quiet when there is no previous session', async () => {
    await renderApp()
    await screen.findByTestId('add-files')
    expect(screen.queryByTestId('last-session')).toBeNull()
  })

  // Dismissing the offer is an answer, not a snooze: the ✕ must clear the stored
  // session so the next launch doesn't ask about the same list all over again.
  it('clears the stored session when the offer is dismissed with the ✕', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
      saveLastSession,
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-dismiss'))
    await waitFor(() => expect(saveLastSession).toHaveBeenCalledWith([], {}))
    await waitFor(() => expect(screen.queryByTestId('last-session')).toBeNull())
  })

  // The save's expensive half (serializing every path and every staged edit) runs on the
  // debounced side, so the "don't snapshot a half-loaded import" guard has to hold THERE,
  // reading the settled list — not just in the effect body that scheduled it. Otherwise a
  // burst that starts mid-import would write rows whose tags hadn't landed, and during a
  // session restore that overwrites the very edits being restored.
  it('never writes a session snapshot while an import is still reading tags', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    let settleSecond: (tags: { title: string }) => void = () => {}
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'First', artist: 'A' }),
      saveLastSession,
    })
    await renderApp()
    // A settled first track ARMS the debounced write — and we deliberately do not wait for
    // it to fire.
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    // Inside that still-open debounce window, a second import lands in the list with its
    // tags in flight. The effect body sees loadingMeta and bails without touching the
    // ALREADY-ARMED timer, which then fires against a half-loaded list. Only the guard on
    // the debounced side catches this — and during a session restore, writing here would
    // overwrite the very edits being restored.
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/b.wav']),
      readTags: vi.fn().mockReturnValue(
        new Promise((r) => {
          settleSecond = r
        }),
      ),
      saveLastSession,
    })
    fireEvent.click(screen.getByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_600))
    })
    expect(saveLastSession).not.toHaveBeenCalled()

    // Once the read lands, the settled two-track list is what gets written.
    await act(async () => {
      settleSecond({ title: 'Second' })
    })
    await waitFor(
      () =>
        expect(saveLastSession).toHaveBeenCalledWith(
          ['/music/a.wav', '/music/b.wav'],
          expect.anything(),
          expect.any(Object),
        ),
      { timeout: 3_000 },
    )
  })

  // An unanswered launch offer for a paths-only session must not park in the corner
  // forever: like the new-tracks prompt it carries a duration, so the shared toast
  // draws its countdown bar and retires the card on its own. Expiring only hides the
  // offer; only the ✕ clears the saved session.
  it('auto-dismisses the offer with a visible countdown', async () => {
    setApi({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    expect(screen.getByTestId('last-session-countdown')).toBeInTheDocument()
  })

  // A session with staged edits counts down the same way as a paths-only one.
  it('counts down the offer even when the session carries staged edits', async () => {
    setApi({
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        paths: ['/music/a.wav'],
        edits: { '/music/a.wav': { meta: { ...emptyMetadata(), title: 'Staged' } } },
      }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    expect(screen.getByTestId('last-session-countdown')).toBeInTheDocument()
  })

  // If the user has already started importing, restoring the old list on top would mix
  // two sessions — the offer withdraws itself the moment rows exist.
  it('withdraws the offer once tracks arrive another way', async () => {
    setApi({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/old.wav'], edits: {} }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    await addTwoTracks()
    await waitFor(() => expect(screen.queryByTestId('last-session')).toBeNull())
  })

  it('remembers the loaded list for the next launch', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({ saveLastSession })
    await renderApp()
    await addTwoTracks()
    // The save is debounced (a burst of keystrokes must coalesce into one atomic
    // write), so the assertion waits past the debounce window.
    await waitFor(
      () =>
        expect(saveLastSession).toHaveBeenCalledWith(
          ['/music/a.wav', '/music/b.wav'],
          expect.any(Object),
          expect.any(Object),
        ),
      { timeout: 3000 },
    )
  })

  // The user feedback behind the edits payload: 400 rips retagged over hours but not
  // yet converted, then the machine froze — every staged edit gone. What the user can
  // change in the editor must ride along with the saved session.
  it('saves staged edits with the session', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({ saveLastSession })
    await renderApp()
    await addTwoTracks()
    fireEvent.change(screen.getByTestId('field-title'), { target: { value: 'Staged Title' } })
    await waitFor(
      () => {
        const call = saveLastSession.mock.calls.at(-1)
        expect(call?.[1]['/music/a.wav'].meta.title).toBe('Staged Title')
      },
      { timeout: 3000 },
    )
    // The untouched second track restores identically from its own file, so it stays
    // out of the map — its presence would make the reopen offer read as "there is
    // work to lose" for a session that has none.
    expect(saveLastSession.mock.calls.at(-1)?.[1]['/music/b.wav']).toBeUndefined()
  })

  // A session that was only loaded (nothing retagged) must save an empty edits map:
  // that emptiness is the signal that lets the next launch's reopen offer keep its
  // self-expiring countdown instead of demanding an answer.
  it('saves no edits when nothing was retagged', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({ saveLastSession })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(saveLastSession).toHaveBeenCalled(), { timeout: 3000 })
    expect(saveLastSession.mock.calls.at(-1)?.[1]).toEqual({})
  })

  // Accepting the reopen offer must bring back the staged edits, not just the file
  // list: the restored metadata wins over the file's own tags (it is the newer truth
  // the user hadn't applied yet), and the matched flag survives so the auto-match
  // sweep doesn't re-probe and overwrite the restored values.
  it('restores staged edits when the session is reopened', async () => {
    setApi({
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        paths: ['/music/a.wav'],
        edits: {
          '/music/a.wav': {
            meta: {
              title: 'Staged Title',
              artist: 'Staged Artist',
              album: 'Staged Album',
              albumArtist: 'Staged Artist',
              year: '2020',
              genre: '',
              grouping: '',
              comment: '',
              trackNumber: 'A1',
              discNumber: '',
              bpm: '',
              key: '',
              publisher: '',
              catalogNumber: '',
              remixArtist: '',
            },
            matched: true,
          },
        },
      }),
      readTags: vi.fn().mockResolvedValue({ title: 'Disk Title', artist: 'Disk Artist' }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    fireEvent.click(screen.getByTestId('last-session-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Staged Title'),
    )
    expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('Staged Artist')
  })

  // The launch-time empty list must never be saved: it would wipe the stored session
  // before the reopen offer had a chance to restore it.
  it('does not overwrite the stored session with the empty launch list', async () => {
    const saveLastSession = vi.fn().mockResolvedValue(undefined)
    setApi({
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
      saveLastSession,
    })
    await renderApp()
    await screen.findByTestId('last-session')
    expect(saveLastSession).not.toHaveBeenCalled()
  })
})

describe('App auto-analyze on import', () => {
  // With the setting on, suspect rips surface on their own: every imported track queues
  // its quality analysis in the background, so the user never has to know the Analyze
  // button exists to be protected from fake-lossless files.
  it('measures imported tracks without pressing Analyze when enabled', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-quality')).toHaveLength(2))
  })

  // Off by default: importing must not spend an ffmpeg decode per row behind the
  // user's back — that cost is exactly why the setting is opt-in.
  it('does not analyze imports while the setting is off', async () => {
    const spectrogram = vi.fn().mockResolvedValue(spectrum)
    const loudness = vi.fn().mockResolvedValue(null)
    setApi({ spectrogram, loudness })
    await renderApp()
    await addTwoTracks()
    // The auto-selected first row's editor measures itself (its own high-priority query);
    // the unselected second row is what the off setting must leave untouched.
    await waitFor(() => expect(spectrogram).toHaveBeenCalled())
    expect(spectrogram).not.toHaveBeenCalledWith('/music/b.wav', expect.anything())
    // loudness is only probed by the sweep (the Quality section gates its own loudness
    // probe on being open, which the editor isn't by default) — never called confirms no
    // sweep ran at all, not just that it skipped the unselected row.
    expect(loudness).not.toHaveBeenCalled()
  })
})

describe('App paste metadata feedback', () => {
  // Copying tags confirms with a toast but pasting used to be silent — on a multi-row
  // paste spree the user couldn't tell whether the shortcut landed. Both halves of the
  // copy/paste pair must speak.
  it('confirms a pasted tag set with the same toast the copy shows', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.contextMenu(rows[0])
    fireEvent.click(await screen.findByTestId('track-menu-copy-meta'))
    expect(await screen.findByText('Metadata copied')).toBeInTheDocument()

    fireEvent.contextMenu(rows[1])
    fireEvent.click(await screen.findByTestId('track-menu-paste-meta'))
    expect(await screen.findByText('Metadata pasted')).toBeInTheDocument()
  })

  // The vinyl-rip case the pair exists for: one side got the full treatment (tags AND
  // artwork), the rest should take all of it in one paste — a copied tag set without
  // its cover would leave the pasted rows half-dressed.
  it('pastes the copied cover along with the tags', async () => {
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      // The selected row's editor mounts the cover well once a cover exists.
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi.fn((path: string) =>
        Promise.resolve(
          path === '/music/a.wav'
            ? { thumbUrl: 'data:image/jpeg;base64,AA', width: 600, height: 600 }
            : null,
        ),
      ),
    })
    await renderApp()
    const rows = await addTwoTracks()
    await waitFor(() => expect(within(rows[0]).getByTestId('track-cover')).toBeInTheDocument())

    fireEvent.contextMenu(rows[0])
    fireEvent.click(await screen.findByTestId('track-menu-copy-meta'))
    // Select the coverless second track: its editor shows the drop zone, not an image.
    fireEvent.click(rows[1])
    await waitFor(() => expect(screen.queryByTestId('cover-preview')).toBeNull())

    fireEvent.contextMenu(rows[1])
    fireEvent.click(await screen.findByTestId('track-menu-paste-meta'))

    // The row thumbnail deliberately stays frozen at import; the LIVE cover the paste
    // set is what the selected track's editor shows (and what a conversion embeds).
    await waitFor(() =>
      expect(screen.getByTestId('cover-preview')).toHaveAttribute(
        'src',
        'data:image/jpeg;base64,AA',
      ),
    )
  })
})

describe('App copy and paste metadata from the editor', () => {
  // Fixing a release means stamping one track's tags onto the next, and the pair used to
  // live only behind a right click on the list. The editor's header pair must reach the
  // same clipboard: what it copies is what the menu pastes, and the other way round.
  it('pastes the tags copied in the editor onto the next track', async () => {
    setApi({
      readTags: vi.fn((path: string) =>
        Promise.resolve(
          path === '/music/a.wav'
            ? { title: 'Rave Party', artist: 'DJ Roy' }
            : { title: 'Untitled', artist: 'Nobody' },
        ),
      ),
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.click(rows[0])
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Rave Party'),
    )
    openMore()
    expect(screen.getByTestId('paste-meta-btn')).toBeDisabled()
    openMore()
    fireEvent.click(screen.getByTestId('copy-meta-btn'))
    expect(await screen.findByText('Metadata copied')).toBeInTheDocument()

    fireEvent.click(rows[1])
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Untitled'),
    )
    openMore()
    fireEvent.click(screen.getByTestId('paste-meta-btn'))
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Rave Party'),
    )
    expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('DJ Roy')
  })
})

describe('App paste metadata onto a selection', () => {
  const coverOf = (path: string) =>
    path === '/music/a.wav'
      ? 'data:image/jpeg;base64,AA'
      : path === '/music/b.wav'
        ? 'data:image/jpeg;base64,BB'
        : null
  const setup = async (copy = true) => {
    const tags: Record<string, Record<string, string>> = {
      '/music/a.wav': {
        title: 'Alpha',
        artist: 'DJ Lara',
        album: 'Source LP',
        trackNumber: '1',
        comment: '8 phrases - Alpha notes',
      },
      '/music/b.wav': {
        title: 'Bravo',
        artist: 'Old B',
        album: 'Old LP',
        trackNumber: '2',
        comment: '5 phrases - Bravo notes',
      },
      '/music/c.wav': { title: 'Charlie', artist: 'Old C', album: 'Old LP', trackNumber: '3' },
    }
    setApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(
          settings({ visibleFields: ['title', 'artist', 'album', 'trackNumber', 'comment'] }),
        ),
      pickFiles: vi.fn().mockResolvedValue(Object.keys(tags)),
      readTags: vi.fn(async (path: string) => tags[path]),
      prepareCoverDrag: vi.fn().mockResolvedValue(null),
      readCover: vi.fn((path: string) => {
        const thumbUrl = coverOf(path)
        return Promise.resolve(thumbUrl ? { thumbUrl, width: 600, height: 600 } : null)
      }),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    await waitFor(() => expect(within(rows[1]).getByTestId('track-cover')).toBeInTheDocument())
    fireEvent.click(rows[0])
    if (copy) {
      fireEvent.contextMenu(rows[0])
      fireEvent.click(await screen.findByTestId('track-menu-copy-meta'))
    }
    fireEvent.click(rows[1])
    fireEvent.click(rows[2], { shiftKey: true })
    return rows
  }
  const open = async (row: HTMLElement, testid: string) => {
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId(testid)).toBeInTheDocument())
    return (screen.getByTestId(testid) as HTMLInputElement).value
  }
  const coverSrc = async (row: HTMLElement) => {
    fireEvent.click(row)
    await waitFor(() => expect(screen.getByTestId('field-title')).toBeInTheDocument())
    return screen.queryByTestId('cover-preview')?.getAttribute('src') ?? null
  }

  // Dressing a whole release from one good track is the point of the clipboard; the
  // release-level fields travel, but each track keeps its own title and number or the
  // paste would flatten the album into copies of one song.
  it('gives every selected track the release fields and keeps their own title and number', async () => {
    const rows = await setup()
    openMore()
    fireEvent.click(screen.getByTestId('paste-meta-btn'))
    expect(await screen.findByText('Metadata pasted')).toBeInTheDocument()

    for (const [row, title, number] of [
      [rows[1], 'Bravo', '2'],
      [rows[2], 'Charlie', '3'],
    ] as const) {
      expect(await open(row, 'field-artist')).toBe('DJ Lara')
      expect(await open(row, 'field-album')).toBe('Source LP')
      expect(await open(row, 'field-title')).toBe(title)
      expect(await open(row, 'field-trackNumber')).toBe(number)
    }
  })

  // A comment opens with the track's own rekordbox phrase count, so pasting the copied
  // one would stamp the source's count on every row; each track keeps its comment.
  it('keeps each selected track its own comment', async () => {
    const rows = await setup()
    openMore()
    fireEvent.click(screen.getByTestId('paste-meta-btn'))
    expect(await screen.findByText('Metadata pasted')).toBeInTheDocument()

    expect(await open(rows[1], 'field-artist')).toBe('DJ Lara')
    expect(await open(rows[1], 'field-comment')).toBe('5 phrases - Bravo notes')
    expect(await open(rows[2], 'field-comment')).toBe('')
  })

  // The paste asks for no confirmation because one undo gives every row back.
  it('undoes the paste on every selected track at once', async () => {
    const rows = await setup()
    openMore()
    fireEvent.click(screen.getByTestId('paste-meta-btn'))
    await screen.findByText('Metadata pasted')
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.queryByTestId('paste-meta-btn')).toBeNull())

    expect(await open(rows[1], 'field-artist')).toBe('Old B')
    expect(await open(rows[2], 'field-artist')).toBe('Old C')
  })

  // A copied cover dresses every selected row, and the single undo must hand each row
  // its own cover back, not leave the pasted one or blank the rows that had none.
  it('pastes the copied cover onto every selected track and undoes it with their own covers', async () => {
    const rows = await setup()
    openMore()
    fireEvent.click(screen.getByTestId('paste-meta-btn'))
    await screen.findByText('Metadata pasted')

    expect(await coverSrc(rows[1])).toBe('data:image/jpeg;base64,AA')
    expect(await coverSrc(rows[2])).toBe('data:image/jpeg;base64,AA')

    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))

    expect(await coverSrc(rows[1])).toBe('data:image/jpeg;base64,BB')
    expect(await coverSrc(rows[2])).toBeNull()
    expect(await open(rows[1], 'field-artist')).toBe('Old B')
  })

  it('disables the editor paste while nothing has been copied', async () => {
    await setup(false)
    openMore()
    expect(screen.getByTestId('paste-meta-btn')).toBeDisabled()
  })

  it('offers the paste in the list menu when several rows are selected', async () => {
    const rows = await setup()
    fireEvent.click(rows[1])
    fireEvent.click(rows[2], { shiftKey: true })
    fireEvent.contextMenu(rows[2])
    fireEvent.click(await screen.findByTestId('track-menu-paste-meta'))
    expect(await screen.findByText('Metadata pasted')).toBeInTheDocument()
    expect(await open(rows[1], 'field-artist')).toBe('DJ Lara')
  })
})

describe('App duplicates filter', () => {
  // The download-folder case this bucket exists for: the same song arriving as two
  // files. The bucket only appears once a real duplicate pair exists, and picking it
  // narrows the list to the group so the user can choose which copy to keep.
  it('lists a duplicates bucket and filters to the duplicated rows', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.flac', '/music/c.wav']),
      readTags: vi.fn((path: string) =>
        Promise.resolve(
          path.includes('/c.')
            ? { title: 'Unique', artist: 'Someone' }
            : { title: 'Strobe', artist: 'deadmau5' },
        ),
      ),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))

    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-list'))
    fireEvent.click(await screen.findByTestId('quality-filter-duplicates'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  // Without a duplicated pair the bucket stays in its place, dimmed at zero, so it is found
  // where it always is the day a crate does hold the same song twice.
  it('dims the duplicates bucket at zero when every track is unique', async () => {
    setApi({
      readTags: vi.fn((path: string) =>
        Promise.resolve({ title: path.includes('/a.') ? 'One' : 'Two', artist: 'X' }),
      ),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-list'))
    const duplicates = screen.getByTestId('quality-filter-duplicates')
    expect(duplicates).toHaveAttribute('data-empty')
    expect(duplicates).toHaveTextContent(/0$/)
  })
})

describe('zoomed window', () => {
  it('keeps the layout at the window minimum so zooming in scrolls instead of clipping the convert button', async () => {
    await renderApp()
    await addTwoTracks()

    expect(screen.getByTestId('app-root')).toHaveStyle({ minWidth: `${WINDOW_MIN_SIZE.width}px` })
  })
})

describe('drop target', () => {
  // With tracks in the list they land in the sidebar, so that is where the drag answers.
  // The old full-screen overlay covered both columns — including the one nothing was going
  // to happen in — to say "drop here" without ever pointing at where "here" was.
  it('marks the column the tracks will land in, covering nothing', async () => {
    await renderApp()
    await addTwoTracks()
    const root = screen.getByTestId('app-root')

    fireEvent.dragEnter(root)

    await waitFor(() =>
      expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drop-over', 'true'),
    )
  })

  it('lights no column for a playlist dragged in the tree, which is not files arriving', async () => {
    await renderApp()
    await addTwoTracks()
    const root = screen.getByTestId('app-root')
    const dt = fakeDataTransfer()
    dt.setData(TREE_NODE_TYPE, 'house')

    fireEvent.dragEnter(root, { dataTransfer: dt })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over', 'true')
  })

  // On the empty screen there is no column yet: the one screen there is answers the drag,
  // not a list column beside it.
  it('lights the one empty screen while the first files are dragged in, and clears it on leave', async () => {
    await renderApp()
    const zone = await screen.findByTestId('empty-dropzone')
    const root = screen.getByTestId('app-root')

    fireEvent.dragEnter(root)

    await waitFor(() => expect(zone).toHaveAttribute('data-drop-over', 'true'))
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()

    fireEvent.dragLeave(root)

    await waitFor(() => expect(zone).not.toHaveAttribute('data-drop-over'))
  })

  // The artwork well handles its own drop and stops it there, so the window never heard
  // the drag was over: the column stayed boxed in accent blue until the next drag, a
  // frame around the tracks that nobody could explain.
  it('clears the mark when the drop lands on the artwork', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    await renderApp()
    await addOneTrack()
    const root = screen.getByTestId('app-root')
    const well = await screen.findByTestId('cover-dropzone')

    fireEvent.dragEnter(root)
    fireEvent.dragEnter(well)
    fireEvent.drop(well, { dataTransfer: { files: [], types: [], getData: () => '' } })

    await waitFor(() => expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over'))
  })

  it('clears the mark when a drag crosses the artwork and leaves the window', async () => {
    setApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']) })
    await renderApp()
    await addOneTrack()
    const root = screen.getByTestId('app-root')
    const well = await screen.findByTestId('cover-dropzone')

    fireEvent.dragEnter(root)
    fireEvent.dragEnter(well)
    fireEvent.dragLeave(well)
    fireEvent.dragLeave(root)

    await waitFor(() => expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-drop-over'))
  })
})

const reviewEntry = (persistentId: string, artist: string) => ({
  persistentId,
  title: `T${persistentId}`,
  artist,
  albumArtist: '',
  album: '',
  genre: '',
})

// A duplicate group's stage button waits for the copies' locations, which arrive after the
// group shows; a click on it before then is swallowed by the disabled button, and on a
// loaded CI runner the review then had nothing to apply.
async function stageGroup(): Promise<void> {
  const stage = await screen.findByTestId('music-review-stage')
  await waitFor(() => expect(stage).toBeEnabled())
  fireEvent.click(stage)
}

function reviewApi(over: Record<string, unknown> = {}): void {
  setApi({
    platform: 'darwin',
    pickFiles: vi.fn().mockResolvedValue(['/music/a.wav']),
    readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
    loadMusicReview: vi.fn().mockResolvedValue([]),
    libraryStatus: vi.fn().mockResolvedValue({
      rekordbox: { enabled: false, found: false },
      engine: { enabled: false, found: false },
      traktor: { enabled: false, found: false },
    }),
    ...over,
  })
}

const spellingFixture = () => ({
  loadMusicReview: vi
    .fn()
    .mockResolvedValue([
      reviewEntry('0000000000000001', 'DJ Lara'),
      reviewEntry('0000000000000002', 'DJ Lara'),
      reviewEntry('0000000000000003', 'Dj Lara'),
    ]),
  applyMusicFixes: vi.fn().mockResolvedValue([
    {
      persistentId: '0000000000000003',
      path: '/music/a.wav',
      fixes: [
        { persistentId: '0000000000000003', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
      ],
      music: ['set'],
      file: 'written',
      written: ['artist'],
      backupId: 'b1',
    },
  ]),
  syncLibraryTags: vi.fn().mockResolvedValue(undefined),
  tagSyncPrograms: vi.fn().mockResolvedValue([]),
  onMusicFixProgress: () => () => {},
  appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
})

describe('App Music review', () => {
  // The review takes the list column while open and gives it back as it was.
  it('swaps the list for the Music review and back', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    await addOneTrack()
    runMenu('music-review')
    expect(await screen.findByTestId('music-review-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('track-row')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })

  // The review needs the room of the main pane for the group it is deciding; the empty
  // screen's invitation to add tracks would sit where that decision goes.
  it('shows the selected group in the main pane instead of the empty screen', async () => {
    vi.resetModules()
    reviewApi(spellingFixture())
    await renderApp()
    expect(screen.getByTestId('add-files')).toBeInTheDocument()
    runMenu('music-review')
    const detail = await screen.findByTestId('music-review-detail')
    await waitFor(() => expect(detail).toHaveTextContent('DJ Lara'))
    expect(screen.queryByTestId('add-files')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findByTestId('add-files')).toBeInTheDocument()
  })

  // Ignoring is saved for good, so the toast right after it is the only way back from a
  // misclick; pressing its Undo returns the group to the review and retires the toast.
  it('brings an ignored group back from the toast Undo', async () => {
    vi.resetModules()
    reviewApi(spellingFixture())
    await renderApp()
    runMenu('music-review')
    const detail = await screen.findByTestId('music-review-detail')
    await waitFor(() => expect(detail).toHaveTextContent('DJ Lara'))
    fireEvent.click(screen.getByTestId('music-review-more'))
    fireEvent.click(screen.getByTestId('music-review-ignore'))
    await waitFor(() => expect(screen.queryAllByTestId('music-review-row')).toHaveLength(0))

    fireEvent.click(await screen.findByTestId('app-notice-action'))

    expect(await screen.findAllByTestId('music-review-row')).toHaveLength(1)
    await waitFor(() => expect(screen.queryByTestId('app-notice')).toBeNull())
  })

  // The review's batch is the screen's main action while it is open, so it takes the
  // toolbar's main button.
  it('puts Apply in the toolbar while the review is open', async () => {
    vi.resetModules()
    reviewApi(spellingFixture())
    await renderApp()
    await addOneTrack()
    runMenu('music-review')
    const apply = await screen.findByTestId('music-review-apply')
    expect(screen.getByTestId('open-settings').closest('header')).toContainElement(apply)
    expect(apply).toHaveTextContent('Apply 0 changes')
    expect(apply).toBeDisabled()
    await stageGroup()
    expect(apply).toHaveTextContent('Apply 1 change')
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    expect(await screen.findByTestId('music-review-confirm')).toBeInTheDocument()
  })

  it('takes Apply out of the toolbar when the review closes', async () => {
    vi.resetModules()
    reviewApi(spellingFixture())
    await renderApp()
    await addOneTrack()
    runMenu('music-review')
    await screen.findByTestId('music-review-apply')
    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() => expect(screen.queryByTestId('music-review-apply')).not.toBeInTheDocument())
  })

  // A running batch has its progress and its only Cancel in the footer; opening the
  // review must not take them away.
  it('keeps the running batch and its cancel in the footer when the review opens', async () => {
    vi.resetModules()
    const cancelJob = vi.fn()
    const processTrack = vi.fn(() => new Promise(() => {}))
    reviewApi({ processTrack, cancelJob, ...spellingFixture() })
    await renderApp()
    await addOneTrack()
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    runMenu('music-review')
    await screen.findByTestId('music-review')
    const cancel = screen.getByTestId('batch-run-cancel')
    expect(cancel).toHaveAccessibleName(/^Cancel the conversion/)
    expect(screen.queryByTestId('music-review-apply')).not.toBeInTheDocument()
    fireEvent.click(cancel)
    expect(cancelJob).toHaveBeenCalled()
  })

  // The offer reopens tracks into a list the review hides; it steps aside without
  // answering for the user, so the next launch still offers the session and its edits.
  it('withdraws the reopen offer when the review opens and keeps the saved session', async () => {
    vi.resetModules()
    const saveLastSession = vi.fn()
    reviewApi({
      saveLastSession,
      getLastSession: vi.fn().mockResolvedValue({
        paths: ['/music/a.wav'],
        edits: { '/music/a.wav': { meta: { title: 'X' } } },
      }),
    })
    await renderApp()
    await screen.findByTestId('last-session')
    runMenu('music-review')
    await screen.findByTestId('music-review')
    await waitFor(() => expect(screen.queryByTestId('last-session')).not.toBeInTheDocument(), {
      timeout: 3000,
    })
    expect(saveLastSession).not.toHaveBeenCalled()
  })

  // Reviewing a library is the point of the view; it must not need a track in the list.
  it('opens over an empty list', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    runMenu('music-review')
    expect(await screen.findByTestId('music-review-empty')).toBeInTheDocument()
  })

  it('opens on the duplicates filter from its own command', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    runMenu('music-duplicates')
    await screen.findByTestId('music-review-empty')
    expect(screen.getByTestId('music-review-filter-trigger')).toHaveTextContent('Duplicates')
  })

  // A file the review rewrote may be open in the list. The row has to say what the file
  // now says and count as clean, or a later Update writes the old artist back over the fix.
  it('shows the fixed artist on a listed track and leaves it with nothing pending', async () => {
    vi.resetModules()
    const readTags = vi.fn().mockResolvedValue({ title: 'T', artist: 'Dj Lara' })
    const fixture = spellingFixture()
    const applied = await fixture.applyMusicFixes()
    const applyMusicFixes = vi.fn(async () => {
      readTags.mockResolvedValue({ title: 'T', artist: 'DJ Lara' })
      return applied
    })
    reviewApi({ readTags, ...fixture, applyMusicFixes })
    await renderApp()
    const [row] = await addOneTrack()
    fireEvent.click(row)
    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('Dj Lara'),
    )
    runMenu('music-review')
    await stageGroup()
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    fireEvent.click(screen.getByTestId('music-review-continue'))
    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('DJ Lara'),
    )
    fireEvent.keyDown((await screen.findAllByTestId('track-row'))[0], { key: 'Backspace' })
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
  })

  // The list is hidden while the review is open; a track shortcut acting on it would
  // remove or convert files the user cannot see.
  it('does not let list shortcuts reach the hidden tracks', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    const [row] = await addOneTrack()
    fireEvent.click(row)
    await screen.findByTestId('editor-trim')
    runMenu('music-review')
    await screen.findByTestId('music-review-empty')
    fireEvent.keyDown(window, { key: 'Backspace', metaKey: true })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
    expect(screen.getByTestId('editor-trim')).toBeInTheDocument()
  })

  // Escape peels one layer at a time: closing Settings must not also throw away the review.
  it('closes only the dialog on top of the review with Escape', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    await addOneTrack()
    runMenu('music-review')
    await screen.findByTestId('music-review-empty')
    fireEvent.click(screen.getByTestId('open-settings'))
    await screen.findByTestId('settings-close')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('settings-close')).not.toBeInTheDocument())
    expect(screen.getByTestId('music-review')).toBeInTheDocument()
  })

  it('does not convert the hidden selected track on the process shortcut', async () => {
    vi.resetModules()
    const processTrack = vi.fn().mockResolvedValue({ outputPath: '/out/a.aiff', inPlace: false })
    reviewApi({ processTrack })
    await renderApp()
    const [row] = await addOneTrack()
    fireEvent.click(row)
    await screen.findByTestId('editor-trim')
    runMenu('music-review')
    await screen.findByTestId('music-review-empty')
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true, shiftKey: true })
    await act(async () => {})
    expect(processTrack).not.toHaveBeenCalled()
  })

  it('holds the review Apply while a conversion is running', async () => {
    vi.resetModules()
    const processTrack = vi.fn(() => new Promise(() => {}))
    reviewApi({ processTrack, ...spellingFixture() })
    await renderApp()
    const [row] = await addOneTrack()
    fireEvent.click(row)
    await screen.findByTestId('editor-trim')
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    runMenu('music-review')
    await stageGroup()
    expect(screen.getByTestId('music-review-apply')).toBeDisabled()
  })

  it('switches the filter when a Music command runs while the review is open', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()
    runMenu('music-review')
    await screen.findByTestId('music-review-empty')
    expect(screen.getByTestId('music-review-filter-trigger')).toHaveTextContent('All')
    runMenu('music-duplicates')
    await waitFor(() =>
      expect(screen.getByTestId('music-review-filter-trigger')).toHaveTextContent('Duplicates'),
    )
  })

  // The sheet and the app both listen for Escape; closing the sheet must not also
  // close the review the user is in the middle of.
  it('closes only the confirmation sheet on Escape', async () => {
    vi.resetModules()
    reviewApi(spellingFixture())
    await renderApp()
    const [row] = await addOneTrack()
    fireEvent.click(row)
    await screen.findByTestId('editor-trim')
    runMenu('music-review')
    await stageGroup()
    fireEvent.click(screen.getByTestId('music-review-apply'))
    expect(await screen.findByTestId('music-review-confirm-apply')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByTestId('music-review-confirm-apply')).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('music-review')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findByTestId('editor-trim')).toBeInTheDocument()
  })

  // From a Music playlist the review is about that playlist: its own metadata, and the
  // copies of its tracks wherever they sit in the library.
  describe('from an open Music playlist', () => {
    const library = [
      { ...reviewEntry('0000000000000001', 'DJ Lara'), title: 'Gold' },
      { ...reviewEntry('0000000000000002', 'DJ Lara'), title: 'Gold' },
      { ...reviewEntry('0000000000000003', 'Dj Lara'), title: 'Iron' },
      { ...reviewEntry('0000000000000005', 'Ana'), title: 'Copper' },
      { ...reviewEntry('0000000000000006', 'Bo'), title: 'Lead' },
      { ...reviewEntry('0000000000000007', 'Bo'), title: 'Lead' },
    ]
    const fridayIds = {
      '/m/gold.wav': '0000000000000001',
      '/m/copper.wav': '0000000000000005',
    }
    const openFriday = async (persistentIds: Record<string, string> = fridayIds) => {
      vi.resetModules()
      reviewApi({
        loadMusicReview: vi.fn().mockResolvedValue(library),
        appleMusicEntryLocation: vi.fn().mockResolvedValue(''),
        loadAppleMusicPlaylists: vi
          .fn()
          .mockResolvedValue([{ persistentId: 'P1', name: 'Friday', count: 2 }]),
        loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
          paths: ['/m/gold.wav', '/m/copper.wav'],
          persistentIds,
          meta: {},
          missing: 0,
        }),
      })
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
      fireEvent.click(await screen.findByTestId('source-node-P1'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
      fireEvent.click(screen.getByTestId('list-actions-more'))
    }

    it('names the playlist and that Apple Music changes, then reviews only its tracks', async () => {
      await openFriday()
      expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
        'The 2 tracks in “Friday”. Changes Apple Music and the files',
      )
      expect(screen.getByTestId('music-duplicates-open-detail')).toHaveTextContent(
        'From “Friday” across your whole Music library',
      )
      fireEvent.click(screen.getByTestId('list-review-open'))
      expect(await screen.findByTestId('music-review-all-clear')).toBeInTheDocument()
      expect(screen.queryAllByTestId('music-review-row')).toHaveLength(0)
      expect(window.api.loadMusicReview).toHaveBeenCalledTimes(1)
    })

    // The copy to delete is usually outside the playlist: Gold's second copy is found, and
    // Lead, whose copies are both outside it, is not the playlist's business.
    it('shows the copies of its tracks found anywhere in the library, and only those', async () => {
      await openFriday()
      fireEvent.click(screen.getByTestId('music-duplicates-open'))
      await waitFor(() => expect(screen.getAllByTestId('music-review-row')).toHaveLength(1))
      expect(screen.getByTestId('music-review-row-name')).toHaveTextContent('Gold')
      expect(screen.getByTestId('music-review-filter-trigger')).toHaveTextContent('Duplicates')
    })

    // Rows with no Music entry behind them are rows the Music review never loads: counting
    // the rows shown would open a review that says the whole library is empty.
    it('offers nothing to review when none of the rows shown is a Music entry', async () => {
      await openFriday({})
      expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
        '“Friday” has no tracks to review',
      )
      expect(screen.getByTestId('list-review-open')).toBeDisabled()
      expect(screen.getByTestId('music-duplicates-open')).toBeDisabled()
      runMenu('list-review')
      await act(async () => {})
      expect(screen.queryByTestId('music-review')).not.toBeInTheDocument()
      expect(window.api.loadMusicReview).not.toHaveBeenCalled()
    })
  })
})

const listApi = (over: Record<string, unknown> = {}) => {
  const tags: Record<string, { title: string; artist: string }> = {
    '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
    '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
    '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
  }
  setApi({
    pickFiles: vi.fn().mockResolvedValue(Object.keys(tags)),
    readTags: vi.fn(async (path: string) => tags[path]),
    properties: vi.fn().mockResolvedValue(null),
    libraryStatus: vi.fn().mockResolvedValue({
      rekordbox: { enabled: false, found: false },
      engine: { enabled: false, found: false },
      traktor: { enabled: false, found: false },
    }),
    applyListFixes: vi.fn(async () => {
      tags['/music/c.wav'] = { title: 'Charlie', artist: 'DJ Lara' }
      return [
        {
          id: '/music/c.wav',
          path: '/music/c.wav',
          fixes: [{ id: '/music/c.wav', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
          music: ['none'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]
    }),
    libraryCopyInfo: vi.fn().mockResolvedValue({}),
    onListFixProgress: () => () => {},
    cancelListFixes: vi.fn(),
    onListRemovalPhase: () => () => {},
    removeListDuplicates: vi.fn().mockResolvedValue([]),
    syncLibraryTags: vi.fn().mockResolvedValue(undefined),
    tagSyncPrograms: vi.fn().mockResolvedValue([]),
    ...over,
  })
}

const addThree = async () => {
  fireEvent.click(await screen.findByTestId('add-files'))
  await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
  return screen.getAllByTestId('track-row')
}

describe('App list review', () => {
  it('opens a track missing a field only the editor fills in the editor', async () => {
    vi.resetModules()
    listApi({
      getSettings: vi
        .fn()
        .mockResolvedValue(settings({ requiredFields: ['title', 'artist', 'bpm'] })),
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async (path: string) =>
        path === '/music/a.wav'
          ? { title: 'Alpha', artist: 'DJ Lara', bpm: '124' }
          : { title: 'Bravo', artist: 'Ann' },
      ),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Alpha'),
    )
    runMenu('list-review')
    fireEvent.click(await screen.findByTestId('music-review-filter-trigger'))
    fireEvent.click(await screen.findByTestId('music-review-filter-incomplete'))
    fireEvent.click((await screen.findAllByTestId('incomplete-row'))[0])
    fireEvent.click(screen.getByTestId('incomplete-stage'))
    await waitFor(() => expect(screen.queryByTestId('music-review')).not.toBeInTheDocument())
    await waitFor(() =>
      expect((screen.getByTestId('field-title') as HTMLInputElement).value).toBe('Bravo'),
    )
  })

  // The user's ask: pick the tracks missing required data in the list and fix them all at once.
  it('fills a track missing required data from the filter, in the review', async () => {
    vi.resetModules()
    listApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn(async (path: string) =>
        path === '/music/a.wav'
          ? { title: 'Alpha', artist: 'DJ Lara' }
          : { title: 'Bravo', artist: '' },
      ),
      applyListFixes: vi.fn().mockResolvedValue([]),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getByTestId('quality-filter-trigger'))
    fireEvent.click(screen.getByTestId('quality-filter-section-tags'))
    fireEvent.click(await screen.findByTestId('quality-filter-missingRequired'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.click(screen.getByTestId('review-incomplete'))
    expect(await screen.findByTestId('music-review-filter-trigger')).toHaveTextContent('Incomplete')
    expect(await screen.findAllByTestId('incomplete-row')).toHaveLength(1)
    fireEvent.click(screen.getAllByTestId('incomplete-row')[0])
    fireEvent.change(screen.getByTestId('incomplete-value'), { target: { value: 'Lara' } })
    fireEvent.click(screen.getByTestId('incomplete-stage'))
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    expect(window.api.applyListFixes).toHaveBeenCalledWith(
      expect.objectContaining({
        fixes: [{ id: '/music/b.wav', field: 'artist', from: '', to: 'Lara' }],
      }),
    )
  })

  // Windows has no Music, but it has the list and the DJ libraries.
  it('opens over the list on Windows and gives the list back as it was', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    runMenu('list-review')
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent('3 tracks in the list')
    expect(screen.queryByTestId('track-row')).not.toBeInTheDocument()
    expect(window.api.appleMusicFileEntries).toBeUndefined()
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(3)
  })

  // A clean review used to leave the main pane blank: nothing said the list was fine, and the
  // only way back was a small X that reads like clearing the search.
  it('says the list is fine when there is nothing to review and leads back to it', async () => {
    vi.resetModules()
    listApi({ pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('list-review')
    expect(await screen.findByTestId('music-review-all-clear')).toHaveTextContent(
      'Everything looks right',
    )
    fireEvent.click(screen.getByTestId('music-review-back'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(2)
    expect(screen.queryByTestId('music-review')).not.toBeInTheDocument()
  })

  it('does nothing with an empty list', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    runMenu('list-review')
    await act(async () => {})
    expect(screen.queryByTestId('music-review')).not.toBeInTheDocument()
    expect(screen.getByTestId('add-files')).toBeInTheDocument()
  })

  // The row shows the fixed artist straight away, so a later Update cannot write the old
  // spelling back over the fix.
  it('fixes a spelling in the file and shows it on the row', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    const rows = await addThree()
    fireEvent.click(rows[2])
    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('Dj Lara'),
    )
    runMenu('list-review')
    await stageGroup()
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(screen.getByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    expect(window.api.applyListFixes).toHaveBeenCalledWith({
      fixes: [{ id: '/music/c.wav', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
      music: {},
      titles: { '/music/c.wav': 'Charlie' },
    })
    fireEvent.click(screen.getByTestId('music-review-continue'))
    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() =>
      expect((screen.getByTestId('field-artist') as HTMLInputElement).value).toBe('DJ Lara'),
    )
  })

  it('takes a trashed duplicate out of the list', async () => {
    vi.resetModules()
    listApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Ann' }),
      spectrogram: vi.fn(() => new Promise(() => {})),
      removeListDuplicates: vi
        .fn()
        .mockResolvedValue([{ from: '/music/b.wav', fileTrashed: true, keptForLibrary: false }]),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    runMenu('list-review')
    await stageGroup()
    fireEvent.click(screen.getByTestId('music-review-apply'))
    fireEvent.click(await screen.findByTestId('music-review-confirm-apply'))
    await screen.findByTestId('music-review-done')
    expect(window.api.removeListDuplicates).toHaveBeenCalledWith([
      { from: '/music/b.wav', to: '/music/a.wav', label: 'Ann - Song' },
    ])
    fireEvent.click(screen.getByTestId('music-review-continue'))
    fireEvent.click(screen.getByTestId('music-review-close'))
    expect(await screen.findAllByTestId('track-row')).toHaveLength(1)
  })

  // The source remembers what the review wrote and trashed; a second click on the entry
  // must not start the review over and drop what the user had staged.
  it('keeps the open review as it is when it is asked for again', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    runMenu('list-review')
    await stageGroup()
    expect(screen.getByTestId('music-review-apply')).toHaveTextContent('Apply 1 change')
    runMenu('list-review')
    await act(async () => {})
    expect(screen.getByTestId('music-review-apply')).toHaveTextContent('Apply 1 change')
    expect(window.api.libraryStatus).toHaveBeenCalledTimes(1)
  })

  // The search, the order and the open sheet belong to the review they were set in; the
  // other review starting with them would hide its groups behind a filter nobody typed.
  it('starts the list review clean when it replaces the Music review', async () => {
    vi.resetModules()
    listApi({
      platform: 'darwin',
      loadMusicReview: vi.fn().mockResolvedValue([]),
      appleMusicFileEntries: vi.fn().mockResolvedValue({ consulted: false, entries: {} }),
    })
    await renderApp()
    await addThree()
    runMenu('music-review')
    await screen.findByTestId('music-review-empty')
    fireEvent.change(screen.getByTestId('music-review-search'), { target: { value: 'Lara' } })
    runMenu('list-review')
    await screen.findByTestId('list-review-scope')
    expect(screen.getByTestId('music-review-search')).toHaveValue('')
  })

  it('saves what is ignored in the list apart from Music', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    runMenu('list-review')
    await screen.findByTestId('music-review-stage')
    fireEvent.click(screen.getByTestId('music-review-more'))
    fireEvent.click(screen.getByTestId('music-review-ignore'))
    await waitFor(() =>
      expect(window.api.saveSettings).toHaveBeenCalledWith({
        listReviewIgnored: [expect.stringContaining('artist')],
      }),
    )
  })

  // The list's own tools live in its header; the review is one of them now that it works
  // on the loaded tracks.
  it('opens from the list header, and holds the button still while a conversion runs', async () => {
    vi.resetModules()
    listApi({ processTrack: vi.fn(() => new Promise(() => {})) })
    await renderApp()
    await addThree()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    const button = screen.getByTestId('list-review-open')
    expect(button).toHaveAccessibleName('Review metadata')
    fireEvent.click(button)
    expect(await screen.findByTestId('list-review-scope')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() => expect(screen.queryByTestId('music-review')).not.toBeInTheDocument())
    runMenu('process-all')
    fireEvent.click(await screen.findByTestId('list-actions-more'))
    await waitFor(() => expect(screen.getByTestId('list-review-open')).toBeDisabled())
  })

  // No source open, the review is the list's, and the line says it writes the files.
  it('says under Review metadata that it changes the files of the whole list', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
      'The 3 tracks in the list. Changes the files',
    )
    expect(screen.queryByTestId('music-duplicates-open')).not.toBeInTheDocument()
  })

  // A rekordbox playlist is the crate the DJ is working on: the review finds what is wrong in
  // it, not in every file that ever passed through the list, and it keeps to the rows the
  // menu named even when another playlist is picked while it is open.
  it('reviews only the open rekordbox playlist and keeps to it when another one is picked', async () => {
    vi.resetModules()
    const entry = (path: string) => ({ path, separator: false, meta: {} })
    listApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue([
            { id: 'f', name: 'Factory', kind: 'playlist', count: 2 },
            { id: 'g', name: 'Closing', kind: 'playlist', count: 1 },
          ]),
          playlist: vi.fn<ProgramReads['playlist']>(async (id) =>
            id === 'f' ? [entry('/music/a.wav'), entry('/music/b.wav')] : [entry('/music/c.wav')],
          ),
        },
      }),
    })
    await renderApp()
    await addThree()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))

    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.getByTestId('list-review-open-detail')).toHaveTextContent(
      'The 2 tracks in “Factory”. Changes the files',
    )
    expect(screen.queryByTestId('music-duplicates-open')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('list-review-open'))
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent(
      /^2 tracks in “Factory”$/,
    )
    expect(await screen.findByTestId('music-review-all-clear')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('source-node-g'))
    await act(async () => {})
    expect(screen.getByTestId('list-review-scope')).toHaveTextContent(/^2 tracks in “Factory”$/)
    expect(screen.getByTestId('music-review-all-clear')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    runMenu('list-review')
    expect(await screen.findByTestId('list-review-scope')).toHaveTextContent(
      /^1 track in “Closing”$/,
    )
  })
})

// A dropped folder is when the user can still fix its names before they spread to the
// libraries; the notice says what the review would find without opening it uninvited.
describe('App list review notice', { timeout: 15000 }, () => {
  it('says what a finished load leaves to review and opens the review from there', async () => {
    vi.resetModules()
    listApi()
    await renderApp()
    await addThree()
    expect(await screen.findByTestId('list-review-notice')).toHaveTextContent(
      '3 tracks loaded. 1 spelling to review',
    )
    fireEvent.click(screen.getByTestId('list-review-notice-action'))
    expect(await screen.findByTestId('list-review-scope')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument())
  })

  it('counts duplicates and spellings together after a drop', async () => {
    vi.resetModules()
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Song', artist: 'Ann' },
      '/music/b.wav': { title: 'Song', artist: 'Ann' },
      '/music/c.wav': { title: 'Other', artist: 'DJ Lara' },
      '/music/d.wav': { title: 'More', artist: 'Dj Lara' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => tags[path]),
      getPathForFile: (f: { name: string }) => f.name,
    })
    await renderApp()
    const root = await screen.findByTestId('app-root')
    fireEvent.drop(root, {
      dataTransfer: { files: Object.keys(tags).map((name) => ({ name })), types: ['Files'] },
    })
    expect(await screen.findByTestId('list-review-notice')).toHaveTextContent(
      '4 tracks loaded. 1 duplicate and 1 spelling to review',
    )
  })

  it('waits for every file of the load to be read before it counts', async () => {
    vi.resetModules()
    let release: () => void = () => {}
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
      '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => {
        if (path === '/music/c.wav') await slow
        return tags[path]
      }),
    })
    await renderApp()
    await addThree()
    await waitFor(() => expect(screen.getAllByTestId('track-row')[1]).toHaveTextContent('Bravo'), {
      timeout: 3000,
    })
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
    await act(async () => release())
    expect(
      await screen.findByTestId('list-review-notice', {}, { timeout: 3000 }),
    ).toHaveTextContent('3 tracks loaded. 1 spelling to review')
  })

  it('stays quiet when the list has nothing to review', async () => {
    vi.resetModules()
    const clean: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'Ann' },
      '/music/b.wav': { title: 'Bravo', artist: 'Bob' },
      '/music/c.wav': { title: 'Charlie', artist: 'Cleo' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => clean[path]),
    })
    await renderApp()
    await addThree()
    await waitFor(() => expect(screen.getAllByTestId('track-row')[2]).toHaveTextContent('Charlie'))
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
  })

  // What the user already chose to ignore in the list review is not news.
  it('leaves out the groups the list review ignores', async () => {
    vi.resetModules()
    const entry = (id: string, title: string, artist: string) => ({
      id,
      title,
      artist,
      albumArtist: '',
      album: '',
      genre: '',
    })
    const ignored = spellingGroups([
      entry('/music/a.wav', 'Alpha', 'DJ Lara'),
      entry('/music/b.wav', 'Bravo', 'DJ Lara'),
      entry('/music/c.wav', 'Charlie', 'Dj Lara'),
    ]).map((g) => g.key)
    expect(ignored).toHaveLength(1)
    listApi({ getSettings: vi.fn().mockResolvedValue(settings({ listReviewIgnored: ignored })) })
    await renderApp()
    await addThree()
    await waitFor(() => expect(screen.getAllByTestId('track-row')[2]).toHaveTextContent('Charlie'))
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
  })

  // The groups the list already had were told about with their own load; a second drop
  // repeating them would read as if the new files brought them.
  it('counts only the groups a later drop takes part in', async () => {
    vi.resetModules()
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
      '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
      '/music/g.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/d.wav': { title: 'Delta', artist: 'Dan' },
      '/music/e.wav': { title: 'Echo', artist: 'Kerri Chandler' },
      '/music/f.wav': { title: 'Foxtrot', artist: 'Kerri chandler' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => tags[path]),
      getPathForFile: (f: { name: string }) => f.name,
    })
    await renderApp()
    const root = await screen.findByTestId('app-root')
    const drop = (paths: string[]) =>
      fireEvent.drop(root, {
        dataTransfer: { files: paths.map((name) => ({ name })), types: ['Files'] },
      })
    drop(['/music/a.wav', '/music/b.wav', '/music/c.wav', '/music/g.wav'])
    expect(await screen.findByTestId('list-review-notice')).toHaveTextContent(
      '4 tracks loaded. 1 duplicate and 1 spelling to review',
    )
    fireEvent.click(screen.getByTestId('list-review-notice-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument())
    drop(['/music/d.wav'])
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('track-row')
          .map((r) => r.textContent)
          .join(),
      ).toContain('Delta'),
    )
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
    drop(['/music/e.wav', '/music/f.wav'])
    expect(await screen.findByTestId('list-review-notice')).toHaveTextContent(
      '2 tracks loaded. 1 spelling to review',
    )
  })

  // The user is already in a review; a prompt to open one would only cover it.
  it('stays quiet about a load that lands while a review is open', async () => {
    vi.resetModules()
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
      '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
      '/music/e.wav': { title: 'Echo', artist: 'Kerri Chandler' },
      '/music/f.wav': { title: 'Foxtrot', artist: 'Kerri chandler' },
    }
    const readTags = vi.fn(async (path: string) => tags[path])
    listApi({ readTags, getPathForFile: (f: { name: string }) => f.name })
    await renderApp()
    await addThree()
    fireEvent.click(await screen.findByTestId('list-review-notice-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument())
    runMenu('list-review')
    await screen.findByTestId('list-review-scope')
    const root = screen.getByTestId('app-root')
    fireEvent.drop(root, {
      dataTransfer: {
        files: ['/music/e.wav', '/music/f.wav'].map((name) => ({ name })),
        types: ['Files'],
      },
    })
    await waitFor(() => expect(readTags).toHaveBeenCalledWith('/music/f.wav'))
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('music-review-close'))
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('track-row')
          .map((r) => r.textContent)
          .join(),
      ).toContain('Foxtrot'),
    )
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
  })

  // Files that arrive another way while the drop's tags are still being read are not
  // part of what the user dropped.
  it('counts only what the drop or the pick handed over', async () => {
    vi.resetModules()
    let release: () => void = () => {}
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    let openWith: ((paths: string[]) => void) | undefined
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
      '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
      '/music/e.wav': { title: 'Echo', artist: 'Kerri Chandler' },
      '/music/f.wav': { title: 'Foxtrot', artist: 'Kerri chandler' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => {
        if (path === '/music/c.wav') await slow
        return tags[path]
      }),
      onOpenFiles: (cb: (paths: string[]) => void) => {
        openWith = cb
        return () => {}
      },
    })
    await renderApp()
    await addThree()
    await act(async () => openWith?.(['/music/e.wav', '/music/f.wav']))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(5))
    await act(async () => release())
    expect(await screen.findByTestId('list-review-notice')).toHaveTextContent(
      '3 tracks loaded. 1 spelling to review',
    )
  })

  it('tells once per load', async () => {
    vi.resetModules()
    let openWith: ((paths: string[]) => void) | undefined
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Alpha', artist: 'DJ Lara' },
      '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
      '/music/c.wav': { title: 'Charlie', artist: 'Dj Lara' },
      '/music/d.wav': { title: 'Delta', artist: 'Dan' },
    }
    listApi({
      readTags: vi.fn(async (path: string) => tags[path]),
      onOpenFiles: (cb: (paths: string[]) => void) => {
        openWith = cb
        return () => {}
      },
    })
    await renderApp()
    await addThree()
    await screen.findByTestId('list-review-notice')
    fireEvent.click(screen.getByTestId('list-review-notice-dismiss'))
    await waitFor(() => expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument())
    await act(async () => openWith?.(['/music/d.wav']))
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('track-row')
          .map((r) => r.textContent)
          .join(),
      ).toContain('Delta'),
    )
    await act(async () => {})
    expect(screen.queryByTestId('list-review-notice')).not.toBeInTheDocument()
  })
})

// The list toolbar had an icon that opened Music's playlists. The rail's Music icon does the
// same, and the toolbar one still showed inside rekordbox, where it read as acting on the
// rekordbox playlist. The rail and the palette are the way in now; the toolbar has no copy.
describe('App list toolbar leaves opening Music to the rail', () => {
  it('has no Music button in Tracks, Music or rekordbox', async () => {
    vi.resetModules()
    const entry = (path: string) => ({ path, separator: false, meta: {} })
    setApi({
      platform: 'darwin',
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: 'f', name: 'Factory', kind: 'playlist', count: 1 }]),
          playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([entry('/m/c.wav')]),
        },
      }),
      loadAppleMusicPlaylists: vi
        .fn<Api['loadAppleMusicPlaylists']>()
        .mockResolvedValue([{ persistentId: 'p1', name: 'Warm up', count: 1 }]),
      loadAppleMusicPlaylistTracks: vi
        .fn<Api['loadAppleMusicPlaylistTracks']>()
        .mockResolvedValue({ paths: ['/m/d.wav'], persistentIds: {}, meta: {}, missing: 0 }),
    })
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('add-files')).toBeInTheDocument()
    expect(screen.queryByTestId('import-apple-playlist')).toBeNull()

    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    fireEvent.click(await screen.findByTestId('source-node-p1'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.queryByTestId('import-apple-playlist')).toBeNull()

    fireEvent.click(screen.getByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-f'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.queryByTestId('import-apple-playlist')).toBeNull()
  })
})

// The empty screen used to offer a card of doors (add, open Music, review, duplicates)
// under section headers. A first screen is read in one glance: the disc, where to drop,
// and the key that opens the dialog. The other doors live in the rail, the palette and
// the menus, where they are reached once there is something to act on.
describe('App empty screen offers a single way in', () => {
  it('puts adding files in the centre panel, not in the track column', async () => {
    vi.resetModules()
    setApi({ platform: 'darwin' })
    await renderApp()

    const add = await screen.findByTestId('add-files')
    expect(add.closest('[data-testid="sidebar"]')).toBeNull()
  })

  it('says only where to drop and which key opens the dialog, with no headers or other doors', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()

    const add = await screen.findByTestId('add-files')
    expect(add).toHaveTextContent('Drop your tracks here')
    expect(screen.getByTestId('empty-pick-hint')).toHaveTextContent('⌘O to choose')
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByText('Bring in tracks')).toBeNull()
    expect(screen.queryByText('Tidy the library')).toBeNull()
    expect(screen.queryByText('Or start here.')).toBeNull()
    expect(within(screen.getByRole('main')).getAllByRole('button')).toEqual([add])
  })

  // The hint teaches the key that really opens the dialog, and off macOS that key is Ctrl.
  it('names the shortcut the way the platform writes it', async () => {
    vi.resetModules()
    reviewApi({ platform: 'win32' })
    await renderApp()

    expect(await screen.findByTestId('empty-pick-hint')).toHaveTextContent('Ctrl+O to choose')
  })

  // The whole panel is the target: aiming at the text, the disc or the space around them
  // has to open the dialog, the way the panel already takes a drop anywhere on it.
  it('opens the file dialog from a click anywhere on the panel', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()

    expect(await screen.findByTestId('add-files')).toContainElement(
      screen.getByTestId('empty-disc'),
    )
    fireEvent.click(screen.getByText('Drop your tracks here'))
    await waitFor(() => expect(window.api.pickFiles).toHaveBeenCalledTimes(1))
  })

  // A native button is what makes Tab reach the panel and Enter or Space open the dialog;
  // a clickable div would leave the keyboard user with no way in. Its name says the action,
  // since the visible line only says where to drop.
  it('is a native button the keyboard can reach, named for adding tracks', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()

    const add = await screen.findByTestId('add-files')
    expect(add.tagName).toBe('BUTTON')
    expect(add).toHaveAttribute('type', 'button')
    expect(add).toHaveAccessibleName('Add tracks')
    act(() => add.focus())
    expect(add).toHaveFocus()
  })

  it('keeps the Music doors in the rail and the palette now that the empty screen drops them', async () => {
    vi.resetModules()
    reviewApi()
    await renderApp()

    await screen.findByTestId('add-files')
    expect(screen.getByTestId('source-rail-appleMusic')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const palette = await screen.findByRole('dialog')
    expect(palette).toHaveTextContent(i18n.t('commands.musicReview'))
    expect(palette).toHaveTextContent(i18n.t('commands.musicDuplicates'))
    expect(palette).toHaveTextContent(i18n.t('commands.importApplePlaylist'))
  })

  // A source with no playlist open has nothing to add files into; its one action is
  // picking a playlist, so the panel says that and a click there opens no dialog.
  it('asks for a playlist instead of files in a source with none open', async () => {
    vi.resetModules()
    reviewApi({ loadAppleMusicPlaylists: vi.fn().mockResolvedValue([]) })
    await renderApp()

    fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
    const pick = await screen.findByTestId('source-pick-playlist')
    expect(pick).toHaveTextContent('Pick a playlist to see its tracks')
    expect(screen.queryByTestId('add-files')).toBeNull()
    fireEvent.click(pick)
    await act(async () => {})
    expect(window.api.pickFiles).not.toHaveBeenCalled()
  })

  describe('Music playlist rows without a file', () => {
    const reply = (rows: { path: string | null }[]) => ({
      paths: rows.filter((r) => r.path).map((r) => r.path),
      persistentIds: {},
      meta: {},
      missing: rows.filter((r) => !r.path).length,
    })
    const openMusic = async (rows: { path: string | null }[], later = rows) => {
      vi.resetModules()
      reviewApi({
        loadAppleMusicPlaylists: vi
          .fn()
          .mockResolvedValue([{ persistentId: 'P1', name: 'Friday', folder: null, count: 3 }]),
        loadAppleMusicPlaylistTracks: vi
          .fn()
          .mockResolvedValueOnce(reply(rows))
          .mockResolvedValue(reply(later)),
      })
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-appleMusic'))
      fireEvent.click(await screen.findByTestId('source-node-P1'))
    }

    it('tells the user how many tracks of the opened playlist have no file', async () => {
      await openMusic([{ path: '/m/a.wav' }, { path: null }, { path: null }])
      expect(await screen.findByTestId('app-notice')).toHaveTextContent(
        '2 tracks from “Friday” have no file on disk',
      )
    })

    it('says it once per opened playlist, not again when opening the Music tab re-reads it', async () => {
      await openMusic(
        [{ path: '/m/a.wav' }, { path: null }],
        [{ path: '/m/a.wav' }, { path: null }, { path: null }],
      )
      const notice = await screen.findByTestId('app-notice')
      fireEvent.click(within(notice).getByTestId('app-notice-dismiss'))
      await waitFor(() => expect(screen.queryByTestId('app-notice')).not.toBeInTheDocument())
      fireEvent.click(screen.getByTestId('source-rail-tracks'))
      fireEvent.click(screen.getByTestId('source-rail-appleMusic'))
      await waitFor(() => expect(window.api.loadAppleMusicPlaylistTracks).toHaveBeenCalledTimes(2))
      await act(async () => {})
      expect(screen.queryByTestId('app-notice')).not.toBeInTheDocument()
    })

    it('stays quiet when every track has its file', async () => {
      await openMusic([{ path: '/m/a.wav' }])
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
      expect(screen.queryByTestId('app-notice')).not.toBeInTheDocument()
    })
  })

  // The panel is where people aim a folder: a drop anywhere on it, the text included,
  // has to bring the tracks in rather than be taken as a click on the button.
  it('adds the files dropped on the empty panel', async () => {
    vi.resetModules()
    reviewApi({ getPathForFile: vi.fn(() => '/music/dropped.wav') })
    await renderApp()

    const file = new File([''], 'dropped.wav')
    fireEvent.drop(await screen.findByText('Drop your tracks here'), {
      dataTransfer: { files: [file], types: ['Files'], getData: () => '' },
    })
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(window.api.expandPaths).toHaveBeenCalledWith(['/music/dropped.wav'], true)
    expect(window.api.pickFiles).not.toHaveBeenCalled()
  })

  // The panel is where the tracks visibly land, so it has to answer the drag the copy
  // invites. Previously only the sidebar carried the drop state.
  it('answers the drag in the panel the copy points at', async () => {
    vi.resetModules()
    setApi({ platform: 'darwin' })
    await renderApp()

    expect(await screen.findByTestId('empty-dropzone')).toBeInTheDocument()
  })
})

const rekordboxCopies: ProgramCopies = {
  program: 'rekordbox',
  collectionPath: '/lib/master.db',
  copies: [
    {
      id: 'c1',
      collectionPath: '/lib/master.db',
      takenAt: Date.now(),
      reason: 'run',
      files: [],
    },
  ],
  restore: null,
  pending: 0,
  halted: false,
  copyFailed: false,
  untouched: false,
}

describe('App Copias music files', () => {
  it('Escape on the restore confirmation closes only the confirmation', async () => {
    setApi({ copiesStatus: vi.fn().mockResolvedValue([rekordboxCopies]) })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-copies'))
    fireEvent.click(await screen.findByTestId('copies-restore-rekordbox'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('copies-screen')).toBeInTheDocument()
  })

  it('Escape on an inline trash confirmation cancels only that confirmation', async () => {
    setApi({
      trashList: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          name: 'a.wav',
          originalPath: '/music/a.wav',
          storedPath: '/ud/trash/items/e1-a.wav',
          bytes: 1024,
          trashedAt: Date.now(),
          reason: 'replaced',
        },
      ]),
    })
    await renderApp()
    act(() => menuListener?.('backups'))
    fireEvent.click(await screen.findByTestId('trash-empty-button'))
    expect(screen.getByTestId('trash-empty-confirm')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('trash-empty-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('copies-screen')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('trash-remove'))
    expect(screen.getByTestId('trash-remove-confirm')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('trash-remove-confirm')).not.toBeInTheDocument()
    expect(screen.getByTestId('copies-screen')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('copies-screen')).not.toBeInTheDocument()
  })

  it('keeps Copias open on Escape while a restore is running, so its outcome is seen', async () => {
    let finish: (r: RestoreResult) => void = () => {}
    setApi({
      copiesStatus: vi.fn().mockResolvedValue([rekordboxCopies]),
      restoreCopy: vi.fn(() => new Promise<RestoreResult>((resolve) => (finish = resolve))),
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-copies'))
    fireEvent.click(await screen.findByTestId('copies-restore-rekordbox'))
    fireEvent.click(screen.getByTestId('confirm-ok'))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByTestId('copies-screen')).toBeInTheDocument()
    await act(async () => finish({ ok: false, reason: 'running' }))
    expect(await screen.findByTestId('copies-refused-rekordbox')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('copies-screen')).not.toBeInTheDocument()
  })

  // The toolbar count is gone; a track Surco backed up says so on its own row, and that
  // mark is the way into its backup: Copias opens on the music files searched to that
  // file, not on the whole list of everything a crate conversion ever rewrote.
  it("a track's backup mark opens Copias on that file", async () => {
    setApi({
      trashList: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          name: 'a.wav',
          originalPath: '/music/a.wav',
          storedPath: '/ud/trash/items/e1-a.wav',
          bytes: 1024,
          trashedAt: Date.now(),
          reason: 'replaced',
          outputPath: '/music/a.wav',
        },
      ]),
    })
    await renderApp()
    const [first, second] = await addTwoTracks()
    const mark = await within(first).findByTestId('track-backup')
    expect(within(second).queryByTestId('track-backup')).toBeNull()

    fireEvent.click(mark)
    await screen.findByTestId('copies-screen')
    expect(screen.getByTestId('copies-toggle-music')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('trash-search')).toHaveValue('a.wav')
    expect(screen.getAllByTestId('trash-row')).toHaveLength(1)
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument()
  })

  // Copias states how long originals stay and how much room they get; showing the
  // shipped defaults instead of the user's own choice tells them their setting did nothing.
  it('shows the retention and size cap the user chose', async () => {
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ backupRetentionDays: 3, backupMaxGb: 2 })),
      trashList: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          name: 'a.wav',
          originalPath: '/music/a.wav',
          storedPath: '/ud/trash/items/e1-a.wav',
          bytes: 1024,
          trashedAt: Date.now(),
          reason: 'replaced',
        },
      ]),
    })
    await renderApp()
    act(() => menuListener?.('backups'))

    const { default: i18n } = await import('./i18n')
    const { formatBytes } = await import('./components/CopiesScreen')
    expect(await screen.findByTestId('copies-screen')).toHaveTextContent(
      i18n.t('copies.footer', { days: 3 }),
    )
    expect(screen.getByTestId('copies-kept-music')).toHaveTextContent(
      formatBytes(2 * 1024 ** 3, i18n.language),
    )
  })
  // Copias opens outside the modal registry, so unless it gates the global shortcuts and
  // answers Escape, the arrows walk the list hidden behind it.
  it('closes on Escape and keeps track shortcuts off the list behind it', async () => {
    setApi({ trashList: vi.fn().mockResolvedValue([]) })
    await renderApp()
    const [first, second] = await addTwoTracks()
    fireEvent.click(first)
    act(() => menuListener?.('backups'))
    await screen.findByTestId('copies-screen')

    fireEvent.keyDown(window, { key: 'ArrowDown', cancelable: true })
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(second).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByTestId('copies-screen')).toBeNull()
    expect(first).toHaveAttribute('aria-selected', 'true')
  })
  // Emptying Originals with one copy held open used to close the confirm and say nothing,
  // so the user believed every copy was gone while some still took the space.
  it('says so when emptying the backups fails', async () => {
    setApi({
      trashList: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          name: 'a.wav',
          originalPath: '/music/a.wav',
          storedPath: '/ud/trash/items/e1-a.wav',
          bytes: 1024,
          trashedAt: Date.now(),
          reason: 'replaced',
        },
      ]),
      trashEmpty: vi.fn().mockRejectedValue(new Error('EBUSY')),
    })
    await renderApp()
    act(() => menuListener?.('backups'))
    fireEvent.click(await screen.findByTestId('trash-empty-button'))
    fireEvent.click(await screen.findByTestId('trash-empty-confirm'))

    const { default: i18n } = await import('./i18n')
    expect(await screen.findByTestId('app-notice')).toHaveTextContent(
      i18n.t('trash.emptyFailed', { reason: '' }).trim(),
    )
  })

  // The keys behind Copias are off, but the menu bar could still reach the list: Convert
  // all from the menu while Copias or a review is open ran a batch under it, two writers on
  // the same files and libraries. The menu waits for Copias like the keyboard does.
  it('runs no track command from the menu bar while Copias is open', async () => {
    const processTrack = vi.fn(async () => ({ outputPath: '/out/x.aiff', inPlace: false }))
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.mp3']),
      readTags: vi.fn().mockResolvedValue({ title: 'My Song', artist: 'Artist' }),
      trashList: vi.fn().mockResolvedValue([]),
      processTrack,
    })
    await renderApp()
    await addTwoTracks()
    act(() => menuListener?.('backups'))
    await screen.findByTestId('copies-screen')

    runMenu('process-all')
    await act(async () => {})
    expect(processTrack).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
  })
  // Deleting a backup for good that fails (the file is locked, the disk went away) used to
  // close the confirm and do nothing, so the user believed the copy was gone.
  it('says so when deleting one backup for good fails', async () => {
    setApi({
      trashList: vi.fn().mockResolvedValue([
        {
          id: 'e1',
          name: 'a.wav',
          originalPath: '/music/a.wav',
          storedPath: '/ud/trash/items/e1-a.wav',
          bytes: 1024,
          trashedAt: Date.now(),
          reason: 'replaced',
        },
      ]),
      trashRemove: vi.fn().mockRejectedValue(new Error('EBUSY')),
    })
    await renderApp()
    act(() => menuListener?.('backups'))
    fireEvent.click(await screen.findByTestId('trash-remove'))
    fireEvent.click(screen.getByTestId('trash-remove-confirm'))

    expect(await screen.findByTestId('app-notice')).toHaveTextContent('a.wav')
  })
})

describe('App list header', () => {
  // The menus gained these entries, but the list header is where the user has always found
  // the list-wide tools, one click away and next to the rows they act on.
  it('keeps select all, go to selected, fill, find, clear and trash in the header', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('list-actions-more'))
    for (const id of [
      'add-files',
      'select-all',
      'track-position',
      'fill-all',
      'open-find-replace',
      'clear-all',
      'trash-selected',
      'remove-selected',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument()
    }
    fireEvent.click(screen.getByTestId('select-all'))
    for (const row of screen.getAllByTestId('track-row')) {
      expect(row).toHaveAttribute('aria-selected', 'true')
    }
  })

  // The list menu reads the palette's own registry, so numbering runs from it exactly as
  // ⌘K runs it, on the same tracks.
  it('numbers the list from the list menu', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    fireEvent.click(screen.getByTestId('list-command-number-tracks'))
    await waitFor(() =>
      expect(screen.getAllByTestId('app-notice-message').map((el) => el.textContent)).toContain(
        i18n.t('notices.numberedTracks', { count: 2 }),
      ),
    )
  })

  // The button sends the selection to the OS Trash; with nothing selected a click did
  // nothing at all, which reads as a broken button rather than an empty selection.
  it('disables the trash button while nothing is selected', async () => {
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('list-actions-more'))
    expect(screen.getByTestId('trash-selected')).toBeEnabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('trash-selected')).toBeDisabled())
  })

  // The visible button only drops rows from the list, so it must never reach the files. It
  // takes the selection at once, like the context menu's Remove, since Undo brings it back.
  it('removes the selection from the list with the visible button at once, never trashing files', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav', '/music/c.wav']),
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      trashFile,
    })
    await renderApp()
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(3))
    const rows = screen.getAllByTestId('track-row')
    fireEvent.click(rows[0])
    fireEvent.click(rows[1], { metaKey: true })
    fireEvent.click(screen.getByTestId('remove-selected'))
    expect(screen.queryByTestId('confirm-ok')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(trashFile).not.toHaveBeenCalled()
  })

  it('disables the remove-from-list button while nothing is selected', async () => {
    await renderApp()
    await addTwoTracks()
    expect(screen.getByTestId('remove-selected')).toBeEnabled()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.getByTestId('remove-selected')).toBeDisabled())
  })

  // The OS Trash is recoverable, so the menu moves the selection there at once with no
  // dialog; with nothing selected there is nothing to move and trashFile is never called.
  it('moves the selection to the Trash from the menu, and nothing without one', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({ trashFile })
    await renderApp()
    await addTwoTracks()
    runMenu('trash-selected')
    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('confirm-ok')).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.getAllByTestId('track-row')[0]).toHaveAttribute('aria-selected', 'false'),
    )
    trashFile.mockClear()
    runMenu('trash-selected')
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(trashFile).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
  })

  it('moves a file on a disk with no Trash to Backups without asking, and its Undo puts back that backup and the row', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'surco', id: 'backup-a' })
    const trashRestore = vi.fn().mockResolvedValue({ restoredTo: '/music/a.wav' })
    setApi({ keepsTrash: vi.fn().mockResolvedValue(false), trashFile, trashRestore })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.contextMenu(rows[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(trashFile).toHaveBeenCalledWith('/music/a.wav', false))
    expect(screen.queryByTestId('confirm-ok')).toBeNull()
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))

    const notice = await waitFor(() => {
      const card = screen
        .getAllByTestId('app-notice')
        .find((c) => c.textContent?.includes(i18n.t('notices.movedToBackups', { count: 1 })))
      if (!card) throw new Error('no backups notice')
      return card
    })
    fireEvent.click(within(notice).getByTestId('app-notice-action'))
    await waitFor(() => expect(trashRestore).toHaveBeenCalledWith('backup-a', 'undo'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
  })

  it('keeps the Undo of an earlier move to Backups when a second one follows, and brings both back', async () => {
    const trashFile = vi.fn(async (path: string) => ({ where: 'surco', id: `backup-${path}` }))
    const trashRestore = vi.fn(async (id: string) => ({ restoredTo: id.slice('backup-'.length) }))
    setApi({ keepsTrash: vi.fn().mockResolvedValue(false), trashFile, trashRestore })
    await renderApp()
    await addTwoTracks()
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))

    const notice = await waitFor(() => {
      const card = screen
        .getAllByTestId('app-notice')
        .find((c) => c.textContent?.includes(i18n.t('notices.movedToBackups', { count: 2 })))
      if (!card) throw new Error('no backups notice for both')
      return card
    })
    fireEvent.click(within(notice).getByTestId('app-notice-action'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    expect(trashRestore).toHaveBeenCalledWith('backup-/music/a.wav', 'undo')
    expect(trashRestore).toHaveBeenCalledWith('backup-/music/b.wav', 'undo')
  })

  it('frees the cover of a row moved to Backups once the notice expires, even after a second move replaced it', async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce('blob:picked')
    const revokeObjectURL = vi.fn()
    const url = URL as unknown as Record<string, unknown>
    const original = { createObjectURL: url.createObjectURL, revokeObjectURL: url.revokeObjectURL }
    Object.assign(url, { createObjectURL, revokeObjectURL })
    try {
      setApi({
        readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
        prepareCoverDrag: vi.fn().mockResolvedValue(null),
        getPathForFile: vi.fn((f: File) => `/img/${f.name}`),
        keepsTrash: vi.fn().mockResolvedValue(false),
        trashFile: vi.fn(async (path: string) => ({ where: 'surco', id: `backup-${path}` })),
      })
      await renderApp()
      await addTwoTracks()
      fireEvent.change(await screen.findByTestId('cover-input'), {
        target: { files: [new File(['x'], 'picked.png', { type: 'image/png' })] },
      })
      await waitFor(() =>
        expect(screen.getByTestId('cover-preview')).toHaveAttribute('src', 'blob:picked'),
      )
      for (let i = 0; i <= MAX_META_UNDO; i++) runMenu('number-tracks')
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getByTestId('track-menu-trash'))
        await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
        fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
        fireEvent.click(screen.getByTestId('track-menu-trash'))
        await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
        expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:picked')
        act(() => vi.advanceTimersByTime(7000))
        await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:picked'))
      } finally {
        vi.useRealTimers()
      }
    } finally {
      Object.assign(url, original)
    }
  })

  it('says once which files could not be put back from Backups, naming the first and counting the rest', async () => {
    setApi({
      keepsTrash: vi.fn().mockResolvedValue(false),
      trashFile: vi.fn(async (path: string) => ({ where: 'surco', id: `backup-${path}` })),
      trashRestore: vi.fn().mockRejectedValue(new Error('gone')),
    })
    await renderApp()
    await addTwoTracks()
    runMenu('select-all')
    fireEvent.contextMenu(screen.getAllByTestId('track-row')[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
    const notice = await waitFor(() => {
      const card = screen
        .getAllByTestId('app-notice')
        .find((c) => c.textContent?.includes(i18n.t('notices.movedToBackups', { count: 2 })))
      if (!card) throw new Error('no backups notice')
      return card
    })
    fireEvent.click(within(notice).getByTestId('app-notice-action'))
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId('app-notice')
          .filter((c) => c.textContent?.includes('Could not restore')),
      ).toHaveLength(1),
    )
    expect(
      screen.getAllByTestId('app-notice').find((c) => c.textContent?.includes('Could not restore')),
    ).toHaveTextContent('Could not restore “a” and 1 more: gone')
  })

  it('keeps the row out of the list when its file could not be put back from Backups', async () => {
    const trashRestore = vi.fn().mockRejectedValue(new Error('gone'))
    setApi({
      keepsTrash: vi.fn().mockResolvedValue(false),
      trashFile: vi.fn().mockResolvedValue({ where: 'surco', id: 'backup-a' }),
      trashRestore,
    })
    await renderApp()
    const rows = await addTwoTracks()
    fireEvent.contextMenu(rows[0])
    fireEvent.click(screen.getByTestId('track-menu-trash'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    const notice = await waitFor(() => {
      const card = screen
        .getAllByTestId('app-notice')
        .find((c) => c.textContent?.includes(i18n.t('notices.movedToBackups', { count: 1 })))
      if (!card) throw new Error('no backups notice')
      return card
    })
    fireEvent.click(within(notice).getByTestId('app-notice-action'))
    await waitFor(() => expect(trashRestore).toHaveBeenCalledWith('backup-a', 'undo'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(screen.getAllByTestId('track-row')).toHaveLength(1)
  })

  // Trashing the flagged rips reaches every flagged visible row, not just the selection, so
  // it is the one Trash move that still asks even when every file keeps its Trash.
  it('asks before trashing the flagged rips even when every file has a Trash', async () => {
    const trashFile = vi.fn().mockResolvedValue({ where: 'trash' })
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings({ autoAnalyze: true })),
      readTags: vi.fn().mockResolvedValue({ title: 'Song', artist: 'Artist' }),
      trashFile,
    })
    await renderApp()
    await addTwoTracks()
    await waitFor(() => expect(screen.getAllByTestId('track-quality')).toHaveLength(2))
    runMenu('trash-suspects')
    fireEvent.click(await screen.findByTestId('confirm-ok'))
    await waitFor(() => expect(trashFile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryAllByTestId('track-row')).toHaveLength(0))
  })
})

// The page shipped with lang="es" baked into index.html and nothing ever touched it, so
// VoiceOver and NVDA read the English, German or French interface with a Spanish voice.
// The document language has to follow the one the interface is actually shown in.
describe('App document language', () => {
  it('follows the interface language', async () => {
    try {
      await renderApp()
      expect(document.documentElement.lang).toBe('en')
      await act(async () => {
        await i18n.changeLanguage('de')
      })
      expect(document.documentElement.lang).toBe('de')
    } finally {
      await act(async () => {
        await i18n.changeLanguage('en')
      })
    }
  })
})

// Like auto-match: what loads gets the fixes nobody would argue with, staged on the row and
// written only by the convert or Update the user already runs.
describe('App clean-up on load', () => {
  const cleanApi = (
    over: Partial<Settings>,
    tags: Record<string, { title: string; artist: string }>,
  ) =>
    listApi({
      getSettings: vi.fn().mockResolvedValue(settings(over)),
      pickFiles: vi.fn().mockResolvedValue(Object.keys(tags)),
      readTags: vi.fn(async (path: string) => tags[path]),
    })
  const load = async (count: number) => {
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(count))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await screen.findByTestId('field-title')
  }
  const spaced = {
    '/music/a.wav': { title: 'Alpha  Mix', artist: 'Ann' },
    '/music/b.wav': { title: 'Bravo', artist: 'Bob' },
  }

  it('leaves every row as read while the settings are off', async () => {
    vi.resetModules()
    cleanApi({}, spaced)
    await renderApp()
    await load(2)
    await act(async () => {})
    expect(screen.queryByTestId('track-cleaned')).not.toBeInTheDocument()
    expect(screen.getByTestId('field-title')).toHaveValue('Alpha  Mix')
  })

  // The row's spark is the whole signal: a toolbar tally of cleaned rows only repeated what
  // the marked rows already show, beside controls that do something.
  it('stages the clean value and marks the row, writing nothing and tallying nothing in the toolbar', async () => {
    vi.resetModules()
    cleanApi({ autoCleanSpacing: true }, spaced)
    await renderApp()
    await load(2)
    await waitFor(() => expect(screen.getAllByTestId('track-cleaned')).toHaveLength(1))
    expect(screen.queryByTestId('auto-clean-count')).not.toBeInTheDocument()
    const [first, second] = screen.getAllByTestId('track-row')
    expect(within(first).getByTestId('track-cleaned')).toBeInTheDocument()
    expect(within(second).queryByTestId('track-cleaned')).not.toBeInTheDocument()
    expect(screen.getByTestId('field-title')).toHaveValue('Alpha Mix')
    expect(window.api.applyListFixes).not.toHaveBeenCalled()
  })

  it('says what was cleaned in the editor and puts the value as read back on undo', async () => {
    vi.resetModules()
    cleanApi({ autoCleanSpacing: true }, spaced)
    await renderApp()
    await load(2)
    expect(await screen.findByTestId('field-cleaned-title')).toHaveTextContent(
      'Cleaned joined repeated spaces',
    )
    fireEvent.click(screen.getByTestId('field-cleaned-undo-title'))
    await waitFor(() => expect(screen.getByTestId('field-title')).toHaveValue('Alpha  Mix'))
    expect(screen.queryByTestId('field-cleaned-title')).not.toBeInTheDocument()
    expect(screen.queryByTestId('track-cleaned')).not.toBeInTheDocument()
  })

  it('writes a name the way most of the list does only when the majority is clear', async () => {
    vi.resetModules()
    cleanApi(
      { autoCleanCase: true },
      {
        '/music/a.wav': { title: 'Alpha', artist: 'Dj Lara' },
        '/music/b.wav': { title: 'Bravo', artist: 'DJ Lara' },
        '/music/c.wav': { title: 'Charlie', artist: 'DJ Lara' },
        '/music/d.wav': { title: 'Delta', artist: 'DJ Lara' },
      },
    )
    await renderApp()
    await load(4)
    await waitFor(() => expect(screen.getAllByTestId('track-cleaned')).toHaveLength(1))
    expect(screen.getByTestId('field-artist')).toHaveValue('DJ Lara')
  })

  it('leaves a close call to the review', async () => {
    vi.resetModules()
    listApi({ getSettings: vi.fn().mockResolvedValue(settings({ autoCleanCase: true })) })
    await renderApp()
    await addThree()
    expect(await screen.findByTestId('list-review-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('track-cleaned')).not.toBeInTheDocument()
  })
})

// "␣Mayday (Original mix)": a read trims, so the row looks clean and a file's leading space
// would never be written away. Cleaned, the row carries the trim as a pending change.
describe('App clean-up of a space the read already trimmed', () => {
  const spacedApi = (
    over: Partial<Settings>,
    saveLastSession = vi.fn().mockResolvedValue(undefined),
  ) => {
    const tags: Record<string, { title: string; artist: string }> = {
      '/music/a.wav': { title: 'Mayday (Original mix)', artist: "Head Horny's" },
      '/music/b.wav': { title: 'Bravo', artist: 'Bob' },
    }
    const processTrack = vi.fn(() => new Promise(() => {}))
    setApi({
      getSettings: vi.fn().mockResolvedValue(settings(over)),
      pickFiles: vi.fn().mockResolvedValue(Object.keys(tags)),
      readMeta: vi.fn(async (path: string) => ({
        tags: tags[path],
        duration: 180,
        cover: null,
        ...(path === '/music/a.wav' && { reviewRaw: { title: ' Mayday (Original mix)' } }),
      })),
      saveLastSession,
      processTrack,
    })
    return { saveLastSession, processTrack }
  }
  const load = async () => {
    fireEvent.click(await screen.findByTestId('add-files'))
    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(2))
    fireEvent.click(screen.getAllByTestId('track-row')[0])
    await screen.findByTestId('field-title')
  }
  const lastEdits = (save: ReturnType<typeof vi.fn>) =>
    (save.mock.calls.at(-1)?.[1] ?? {}) as Record<string, { meta: { title: string } }>

  it('keeps the trim as a pending change and writes the trimmed title', async () => {
    vi.resetModules()
    const { saveLastSession, processTrack } = spacedApi({ autoCleanSpacing: true })
    await renderApp()
    await load()
    expect(await screen.findByTestId('field-cleaned-title')).toHaveTextContent(
      'Cleaned removed a leading space · Undo',
    )
    await waitFor(
      () =>
        expect(lastEdits(saveLastSession)['/music/a.wav']?.meta.title).toBe(
          'Mayday (Original mix)',
        ),
      { timeout: 3000 },
    )
    runMenu('process-all')
    await waitFor(() => expect(processTrack).toHaveBeenCalled())
    const job = processTrack.mock.calls
      .map((c) => (c as unknown as [{ inputPath: string; meta: { title: string } }])[0])
      .find((j) => j.inputPath === '/music/a.wav')
    expect(job?.meta.title).toBe('Mayday (Original mix)')
  })

  it('leaves the row clean while the setting is off', async () => {
    vi.resetModules()
    const { saveLastSession } = spacedApi({})
    await renderApp()
    await load()
    await waitFor(() => expect(saveLastSession).toHaveBeenCalled(), { timeout: 3000 })
    expect(lastEdits(saveLastSession)).toEqual({})
    expect(screen.queryByTestId('field-cleaned-title')).not.toBeInTheDocument()
  })

  it('undoes back to the file as it is, with nothing left to save', async () => {
    vi.resetModules()
    const { saveLastSession } = spacedApi({ autoCleanSpacing: true })
    await renderApp()
    await load()
    fireEvent.click(await screen.findByTestId('field-cleaned-undo-title'))
    await waitFor(() =>
      expect(screen.getByTestId('field-title')).toHaveValue(' Mayday (Original mix)'),
    )
    await waitFor(() => expect(lastEdits(saveLastSession)).toEqual({}), { timeout: 3000 })
  })
})

// The footer's check is fed from main and answered through it: each piece is tested alone,
// and this pins that App hands them to the footer of the track that was converted.
describe('App verification', () => {
  it('a check from main reaches the footer, and its retry and Originales reach main and Copias', async () => {
    let push: Parameters<Api['onVerifyUpdate']>[0] = () => {}
    const retryVerification = vi.fn<Api['retryVerification']>().mockResolvedValue('rechecked')
    const processTrack = vi.fn<Api['processTrack']>().mockResolvedValue({
      outputPath: '/out/x.aiff',
      inPlace: false,
      verification: {
        status: 'checking',
        checks: [{ place: 'file', state: 'checking', detail: { key: 'checking' } }],
        job: 'j1',
        seq: 0,
      },
    })
    setApi({
      readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
      processTrack,
      retryVerification,
      onVerifyUpdate: vi.fn<Api['onVerifyUpdate']>((cb) => {
        push = cb
        return () => {}
      }),
      trashList: vi.fn().mockResolvedValue([]),
    })
    await renderApp()
    const [row] = await addTwoTracks()
    fireEvent.click(row)
    fireEvent.click(await screen.findByTestId('process-btn'))
    await screen.findByTestId('verify-checking')
    const id = processTrack.mock.calls[0][0].id

    act(() =>
      push(id, {
        status: 'mismatch',
        checks: [
          {
            place: 'file',
            state: 'mismatch',
            detail: { key: 'fileSourceGone', params: { kept: 1 } },
          },
          { place: 'rekordbox', state: 'mismatch', detail: { key: 'rekordboxStillOld' } },
        ],
        job: 'j1',
        seq: 1,
      }),
    )
    expect(await screen.findByTestId('verify-mismatch')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('verify-retry'))
    await waitFor(() => expect(retryVerification).toHaveBeenCalledWith(id))

    fireEvent.click(await screen.findByTestId('verify-open-originals'))
    expect(await screen.findByTestId('copies-screen')).toBeInTheDocument()
  })
})

describe('paste tracklist from the tree', () => {
  const TREE = [
    { id: 'sets', name: 'Sets', kind: 'folder' as const, count: 1, children: [] },
    { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 2 },
  ]
  function openRekordboxTree(editOverride?: Mock<ProgramReads['editPlaylist']>) {
    const editPlaylist =
      editOverride ??
      vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({
        applied: true,
        report: { added: 1, already: 0, notInCollection: 0, ambiguous: 0 },
      })
    setApi({
      dj: djReads({
        rekordbox: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          editPlaylist,
          tree: vi.fn<ProgramReads['tree']>().mockResolvedValue(TREE),
          collection: vi.fn<ProgramReads['collection']>().mockResolvedValue([
            {
              contentId: '41',
              path: '/m/a.wav',
              title: 'Silent Tears (Extended Mix)',
              artist: 'Jessy',
            },
          ]),
        },
      }),
    })
    return editPlaylist
  }
  async function pasteAndAdd(nodeId: string, name?: string): Promise<void> {
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.contextMenu(await screen.findByTestId(`source-node-${nodeId}`))
    fireEvent.click(screen.getByTestId('source-tree-paste-tracklist'))
    fireEvent.change(await screen.findByTestId('paste-tracklist-text'), {
      target: { value: 'Jessy - Silent Tears (Extended Mix)' },
    })
    if (name)
      fireEvent.change(screen.getByTestId('paste-tracklist-name'), { target: { value: name } })
    fireEvent.click(screen.getByTestId('paste-tracklist-search'))
    await waitFor(() => expect(screen.getByTestId('paste-tracklist-add')).toBeEnabled())
    fireEvent.click(screen.getByTestId('paste-tracklist-add'))
  }

  it('adds the matched tracks to the playlist the menu was opened on', async () => {
    const edit = openRekordboxTree()
    await pasteAndAdd('f')
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        { kind: 'add', playlistId: 'f', tracks: [{ contentId: '41', paths: ['/m/a.wav'] }] },
        'Factory',
      ),
    )
    await waitFor(() =>
      expect(screen.queryByTestId('paste-tracklist-dialog')).not.toBeInTheDocument(),
    )
  })

  it('closes the tracklist modal on Escape, like every other dialog', async () => {
    openRekordboxTree()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-f'))
    fireEvent.click(screen.getByTestId('source-tree-paste-tracklist'))
    fireEvent.change(await screen.findByTestId('paste-tracklist-text'), {
      target: { value: 'Jessy - Silent Tears (Extended Mix)' },
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByTestId('paste-tracklist-dialog')).not.toBeInTheDocument(),
    )
  })

  it('keeps the global shortcuts off the list while the tracklist modal is open', async () => {
    openRekordboxTree()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-f'))
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await screen.findByTestId('palette-input')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('palette-input')).not.toBeInTheDocument())
    fireEvent.click(screen.getByTestId('source-tree-paste-tracklist'))
    await screen.findByTestId('paste-tracklist-dialog')
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('palette-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('paste-tracklist-dialog')).toBeInTheDocument()
  })

  it('sends a new playlist and its tracks in one edit, so a create queued behind an open program still carries them', async () => {
    const edit = openRekordboxTree(
      vi
        .fn<ProgramReads['editPlaylist']>()
        .mockResolvedValue({ applied: false, queued: true, opId: 'op1' }),
    )
    await pasteAndAdd('sets', 'Mi set')
    await waitFor(() => expect(edit).toHaveBeenCalled())
    await act(async () => {})
    expect(edit).toHaveBeenCalledExactlyOnceWith(
      {
        kind: 'create',
        parentId: 'sets',
        name: 'Mi set',
        folder: false,
        tracks: [{ contentId: '41', paths: ['/m/a.wav'] }],
      },
      'Mi set',
    )
  })

  it('asks once to close rekordbox before it creates the playlist with its tracks', async () => {
    const edit = openRekordboxTree(
      vi.fn<ProgramReads['editPlaylist']>().mockResolvedValue({ applied: true, createdId: 'new' }),
    )
    await pasteAndAdd('sets', 'Mi set')
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
    expect(window.api.dj.askToApply).toHaveBeenCalledExactlyOnceWith(['rekordbox'])
    expect(vi.mocked(window.api.dj.askToApply).mock.invocationCallOrder[0]).toBeLessThan(
      edit.mock.invocationCallOrder[0],
    )
  })

  it('tells the user why a playlist with its tracks could not be created, and says nothing went in', async () => {
    const edit = openRekordboxTree(
      vi
        .fn<ProgramReads['editPlaylist']>()
        .mockResolvedValue({ applied: false, reason: 'rekordbox-running' }),
    )
    await pasteAndAdd('sets', 'Mi set')
    expect(await screen.findByTestId('rekordbox-edit-notice')).toHaveTextContent(
      i18n.t('sources.edit.refused.running'),
    )
    await act(async () => {})
    expect(edit).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('rekordbox-edit-notice')).toHaveLength(1)
    expect(screen.getByTestId('rekordbox-edit-notice')).not.toHaveTextContent(
      i18n.t('sources.edit.added', { count: 1, name: 'Mi set' }),
    )
  })
})

describe('automatic session from the tree', () => {
  const TREE = [
    { id: 'sets', name: 'Sets', kind: 'folder' as const, count: 0, children: [] },
    { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 1 },
  ]
  const ROW = {
    path: '/m/a.wav',
    separator: false,
    contentId: '41',
    meta: { bpm: '140' },
    preview: { title: 'Silent Tears', artist: 'Jessy', durationSec: 300, cues: [] },
  }
  function openRekordboxTree(over: ApiOverrides = {}, tree: SourceNode[] = TREE) {
    const edit = vi
      .fn<ProgramReads['editPlaylist']>()
      .mockResolvedValueOnce({ applied: true, createdId: 'new' })
      .mockResolvedValue({ applied: true })
    setApi({
      djAppRunning: vi.fn<Api['djAppRunning']>().mockResolvedValue(false),
      ...over,
      dj: djReads(
        {
          rekordbox: {
            available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
            editPlaylist: edit,
            tree: vi.fn<ProgramReads['tree']>().mockResolvedValue(tree),
            playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue([ROW]),
          },
        },
        over.dj,
      ),
    })
    return edit
  }
  async function openWizard(): Promise<void> {
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-sets'))
    fireEvent.click(screen.getByTestId('source-tree-session'))
    await screen.findByTestId('session-wizard-dialog')
  }
  async function toBuild(): Promise<void> {
    await openWizard()
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'fact' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-f-any'))
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    await screen.findByTestId('session-wizard-build')
  }

  describe('filling a playlist that was emptied', () => {
    const WITH_EMPTIED = [
      {
        id: 'sets',
        name: 'Sets',
        kind: 'folder' as const,
        count: 1,
        children: [{ id: 'emptied', name: 'Session 11-9', kind: 'playlist' as const, count: 0 }],
      },
      { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 1 },
    ]

    async function openFill(): Promise<void> {
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
      fireEvent.click(await screen.findByTestId('source-node-sets'))
      fireEvent.contextMenu(await screen.findByTestId('source-node-emptied'))
      fireEvent.click(screen.getByTestId('source-tree-fill-session'))
      await screen.findByTestId('session-wizard-dialog')
      fireEvent.click(screen.getByTestId('session-wizard-next'))
      fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'fact' } })
      fireEvent.click(screen.getByTestId('session-wizard-role-f-any'))
      fireEvent.click(screen.getByTestId('session-wizard-next'))
      await screen.findByTestId('session-wizard-build')
    }

    it('writes the session into that playlist and creates no other', async () => {
      const edit = openRekordboxTree({}, WITH_EMPTIED)
      await openFill()
      fireEvent.click(screen.getByTestId('session-wizard-build'))
      await waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
      expect(edit.mock.calls[0][0]).toEqual({
        kind: 'add',
        playlistId: 'emptied',
        tracks: [{ contentId: '41', paths: ['/m/a.wav'] }],
      })
      await waitFor(() =>
        expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
      )
    })

    it('says the session stays as a normal playlist when it is kept', async () => {
      openRekordboxTree({}, WITH_EMPTIED)
      await openFill()
      fireEvent.click(screen.getByTestId('session-wizard-build'))
      fireEvent.click(await screen.findByTestId('session-band-keep'))
      expect(await screen.findByText('Kept as a normal playlist')).toBeInTheDocument()
      expect(screen.queryByTestId('session-band')).not.toBeInTheDocument()
    })

    it('shows the band over it, so it can be redone', async () => {
      openRekordboxTree({}, WITH_EMPTIED)
      await openFill()
      fireEvent.click(screen.getByTestId('session-wizard-build'))
      expect(await screen.findByTestId('session-band')).toBeInTheDocument()
    })
  })

  describe('starting a session from a track', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({
      ...ROW,
      path: `/m/${i}.wav`,
      contentId: String(40 + i),
      preview: { ...ROW.preview, title: `Track ${i}` },
    }))

    async function openFromTrack(index: number): Promise<void> {
      await renderApp()
      fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
      fireEvent.click(await screen.findByTestId('source-node-f'))
      await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(rows.length))
      fireEvent.contextMenu(screen.getAllByTestId('track-row')[index])
      fireEvent.click(await screen.findByTestId('track-menu-start-session'))
      await screen.findByTestId('session-wizard-dialog')
    }

    it('writes the session starting with that track, taking its own playlist as already chosen', async () => {
      const edit = openRekordboxTree({
        dj: djReads({
          rekordbox: { playlist: vi.fn<ProgramReads['playlist']>().mockResolvedValue(rows) },
        }),
      })
      await openFromTrack(rows.length - 1)
      fireEvent.click(screen.getByTestId('session-wizard-next'))
      fireEvent.click(await screen.findByTestId('session-wizard-next'))
      fireEvent.click(await screen.findByTestId('session-wizard-build'))
      await waitFor(() => expect(edit).toHaveBeenCalledOnce())
      const made = edit.mock.calls[0][0] as { tracks: { contentId: string }[] }
      expect(made.tracks[0].contentId).toBe(String(40 + rows.length - 1))
    })

    it('offers nothing before a playlist is open', async () => {
      openRekordboxTree()
      await renderApp()
      expect(screen.queryByTestId('track-menu-start-session')).not.toBeInTheDocument()
    })
  })

  it('says in the last step which folder the new playlist goes to', async () => {
    openRekordboxTree()
    await toBuild()
    expect(screen.getByTestId('session-wizard-destination')).toHaveTextContent('Sets')
  })

  it('says in the last step that it will fill the emptied playlist', async () => {
    openRekordboxTree({}, [
      {
        id: 'sets',
        name: 'Sets',
        kind: 'folder' as const,
        count: 1,
        children: [{ id: 'emptied', name: 'Session 11-9', kind: 'playlist' as const, count: 0 }],
      },
      { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 1 },
    ])
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    fireEvent.click(await screen.findByTestId('source-node-sets'))
    fireEvent.contextMenu(await screen.findByTestId('source-node-emptied'))
    fireEvent.click(screen.getByTestId('source-tree-fill-session'))
    await screen.findByTestId('session-wizard-dialog')
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'fact' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-f-any'))
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    await screen.findByTestId('session-wizard-build')
    expect(screen.getByTestId('session-wizard-destination')).toHaveTextContent('Session 11-9')
  })

  it('starts reading in the background the playlists that say which tracks are bases and vocals, as soon as the wizard opens', async () => {
    const tree = [
      { id: 'sets', name: 'Sets', kind: 'folder' as const, count: 0, children: [] },
      {
        id: 'bases',
        name: 'BASES',
        kind: 'folder' as const,
        count: 1,
        children: [{ id: 'bt', name: 'Todas', kind: 'playlist' as const, count: 1 }],
      },
      { id: 'f', name: 'Factory', kind: 'playlist' as const, count: 1 },
    ]
    openRekordboxTree({}, tree)
    const read = vi.mocked(window.api.dj.playlist)
    await openWizard()
    await waitFor(() =>
      expect(read.mock.calls.some(([program, id]) => program === 'rekordbox' && id === 'bt')).toBe(
        true,
      ),
    )
  })

  it('does not read playlists for roles when no folder is called like a role', async () => {
    openRekordboxTree()
    const read = vi.mocked(window.api.dj.playlist)
    await openWizard()
    await act(async () => {})
    expect(read.mock.calls.some(([program, id]) => program === 'rekordbox' && id === 'bt')).toBe(
      false,
    )
  })

  it('opens from the menu of a folder', async () => {
    openRekordboxTree()
    await openWizard()
    expect(screen.getByTestId('session-wizard-dialog')).toBeInTheDocument()
  })

  it('opens from the command palette', async () => {
    openRekordboxTree()
    await renderApp()
    fireEvent.click(await screen.findByTestId('source-rail-rekordbox'))
    await screen.findByTestId('source-node-sets')
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'automatic session' } })
    fireEvent.click(await screen.findByText('Automatic session…'))
    expect(await screen.findByTestId('session-wizard-dialog')).toBeInTheDocument()
  })

  it('does not offer it from the palette where nothing can be written', async () => {
    setApi({})
    await renderApp()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = await screen.findByTestId('palette-input')
    fireEvent.change(input, { target: { value: 'automatic session' } })
    expect(screen.queryByText('Automatic session…')).not.toBeInTheDocument()
  })

  it('closes on Escape, like every other dialog', async () => {
    openRekordboxTree()
    await openWizard()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
    )
  })

  it('keeps the global shortcuts off the list while the wizard is open', async () => {
    openRekordboxTree()
    await openWizard()
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    expect(screen.queryByTestId('palette-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('session-wizard-dialog')).toBeInTheDocument()
  })

  it('writes the session into the folder it was opened on, tracks in order, once nothing is open', async () => {
    const edit = openRekordboxTree()
    await toBuild()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await waitFor(() => expect(edit).toHaveBeenCalledOnce())
    expect(edit.mock.calls[0][0]).toMatchObject({
      kind: 'create',
      parentId: 'sets',
      folder: false,
      tracks: [{ contentId: '41', paths: ['/m/a.wav'] }],
    })
    await waitFor(() =>
      expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
    )
  })

  it('reads the playlists again each time the wizard is opened, so edits made since are seen', async () => {
    openRekordboxTree()
    const read = vi.mocked(window.api.dj.playlist)
    await openWizard()
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'fact' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-f-any'))
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    await screen.findByTestId('session-wizard-build')
    const first = read.mock.calls.filter(([program]) => program === 'rekordbox').length
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300))
    })
    fireEvent.contextMenu(screen.getByTestId('source-node-sets'))
    fireEvent.click(screen.getByTestId('source-tree-session'))
    await screen.findByTestId('session-wizard-dialog')
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    expect(screen.getByTestId('session-wizard-none')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('playlists-search'), { target: { value: 'fact' } })
    fireEvent.click(screen.getByTestId('session-wizard-role-f-any'))
    fireEvent.click(screen.getByTestId('session-wizard-next'))
    await screen.findByTestId('session-wizard-build')
    expect(read.mock.calls.filter(([program]) => program === 'rekordbox').length).toBeGreaterThan(
      first,
    )
  })

  it('opens the session once rekordbox closes and the queue writes it, with its band', async () => {
    let applied: (a: RekordboxQueueApplied) => void = () => {}
    openRekordboxTree(
      {
        dj: djReads({
          rekordbox: {
            editPlaylist: vi
              .fn<ProgramReads['editPlaylist']>()
              .mockResolvedValue({ applied: false, queued: true, opId: 'op1' }),
            onCueQueueApplied: (cb) => {
              applied = cb
              return () => {}
            },
          },
        }),
      },
      [...TREE, { id: 'new', name: 'Session', kind: 'playlist' as const, count: 1 }],
    )
    await toBuild()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await waitFor(() =>
      expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
    )
    expect(screen.queryByTestId('session-band')).toBeNull()
    act(() =>
      applied({
        tracks: 0,
        changes: 1,
        notices: [],
        written: [],
        created: [{ opId: 'op1', createdId: 'new' }],
      }),
    )
    expect(await screen.findByTestId('session-band')).toBeInTheDocument()
  })

  it('builds while the DJ program is open, sending the session to wait for it to close', async () => {
    const edit = vi
      .fn<ProgramReads['editPlaylist']>()
      .mockResolvedValue({ applied: false, queued: true, opId: 'op1' })
    openRekordboxTree({
      djAppRunning: vi.fn<Api['djAppRunning']>().mockResolvedValue(true),
      dj: djReads({ rekordbox: { editPlaylist: edit } }),
    })
    await toBuild()
    fireEvent.click(screen.getByTestId('session-wizard-build'))
    await waitFor(() =>
      expect(screen.queryByTestId('session-wizard-dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(edit).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'create', tracks: expect.any(Array) }),
        expect.any(String),
      ),
    )
  })
})

// Hiding the sidebar is for the user who wants the whole window for the list and the
// editor; it has to take the rail and the playlists with it and leave a way back.
// Typing a playlist's name in ⌘K is the fastest way into it, from any source and with the
// sidebar hidden or not.
describe('App palette playlists', () => {
  it('opens a playlist of another source from the palette', async () => {
    const playlist = vi
      .fn<ProgramReads['playlist']>()
      .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }])
    setApi({
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Carcer edits', kind: 'playlist', count: 1 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist,
        },
      }),
    })
    await renderApp()
    await screen.findByTestId('source-rail-engine')
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'carcer' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Engine DJ › Carcer edits' }))
    await waitFor(() => expect(playlist).toHaveBeenCalledWith('7'))
    expect(screen.getByTestId('source-rail-engine')).toHaveAttribute('aria-pressed', 'true')
  })

  // The palette is a way to open a playlist like the tree: a search typed before it would
  // hide what the playlist holds the moment it opens.
  it('clears the search when a playlist is opened from the palette', async () => {
    setApi({
      pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
      dj: djReads({
        engine: {
          available: vi.fn<ProgramReads['available']>().mockResolvedValue(true),
          tree: vi
            .fn<ProgramReads['tree']>()
            .mockResolvedValue([{ id: '7', name: 'Carcer edits', kind: 'playlist', count: 1 }]),
          recentCount: vi.fn<ProgramReads['recentCount']>().mockResolvedValue(0),
          playlist: vi
            .fn<ProgramReads['playlist']>()
            .mockResolvedValue([{ path: '/m/c.wav', separator: false, meta: {} }]),
        },
      }),
    })
    await renderApp()
    await addTwoTracks()
    fireEvent.change(screen.getByTestId('track-search'), { target: { value: 'zz' } })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    fireEvent.change(await screen.findByTestId('palette-input'), { target: { value: 'carcer' } })
    fireEvent.click(await screen.findByRole('option', { name: 'Engine DJ › Carcer edits' }))

    await waitFor(() => expect(screen.getAllByTestId('track-row')).toHaveLength(1))
    expect(screen.getByTestId('track-search')).toHaveValue('')
  })
})

describe('App sidebar', () => {
  // Kept mounted off screen so it can slide back out the way it came, but nothing in it can
  // take a click or the focus while it is away.
  it('keeps the rail and the playlists out of view and out of reach while the sidebar is hidden', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ showSidebar: false })) })
    await renderApp()
    await addTwoTracks()
    const peek = screen.getByTestId('sidebar-peek')
    expect(peek).not.toHaveAttribute('data-open')
    expect(peek).toHaveAttribute('inert')
  })

  // A hidden sidebar must not cost the user the playlists: resting the pointer on the left
  // edge lays it over the list, and leaving it puts it away again.
  it('lays the sidebar over the list while the pointer rests on the left edge', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ showSidebar: false })) })
    await renderApp()
    await addTwoTracks()
    fireEvent.pointerEnter(screen.getByTestId('sidebar-edge'))
    await waitFor(() => expect(screen.getByTestId('sidebar-peek')).toHaveAttribute('data-open'))
    expect(screen.getByTestId('sidebar-peek')).not.toHaveAttribute('inert')
    fireEvent.pointerLeave(screen.getByTestId('sidebar-peek'))
    await waitFor(() => expect(screen.getByTestId('sidebar-peek')).not.toHaveAttribute('data-open'))
  })

  // The edge has to be found; the location over the list is in plain sight and opens the
  // same sidebar at once.
  it('opens the sidebar over the list from the location in the list header', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ showSidebar: false })) })
    await renderApp()
    await addTwoTracks()
    fireEvent.click(screen.getByTestId('track-list-location'))
    expect(screen.getByTestId('sidebar-peek')).toHaveAttribute('data-open')
    fireEvent.keyDown(screen.getByTestId('sidebar-peek'), { key: 'Escape' })
    expect(screen.getByTestId('sidebar-peek')).not.toHaveAttribute('data-open')
  })

  it('brings the sidebar back from the right-click on the list header', async () => {
    setApi({ getSettings: vi.fn().mockResolvedValue(settings({ showSidebar: false })) })
    await renderApp()
    await addTwoTracks()
    fireEvent.contextMenu(screen.getByTestId('track-list-toolbar'))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: i18n.t('view.sidebar') }))
    await waitFor(() => expect(screen.queryByTestId('sidebar-peek')).not.toBeInTheDocument())
    expect(screen.getByTestId('source-rail')).toBeInTheDocument()
  })
})

describe('App editor crash', () => {
  it('keeps the running batch and its cancel under the editor when the editor crashes mid-batch', async () => {
    const silenced = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.resetModules()
    vi.doMock('./components/Editor', () => ({
      Editor: () => {
        throw new Error('boom')
      },
    }))
    try {
      const pending: ((v: unknown) => void)[] = []
      const processTrack = vi.fn(() => new Promise((resolve) => pending.push(resolve)))
      const cancelJob = vi.fn(() => {
        for (const resolve of pending.splice(0))
          resolve({ outputPath: '', inPlace: false, skipped: true })
      })
      setApi({
        pickFiles: vi.fn().mockResolvedValue(['/music/a.wav', '/music/b.wav']),
        readTags: vi.fn().mockResolvedValue({ title: 'T', artist: 'A' }),
        processTrack,
        cancelJob,
      })
      await renderApp()
      const rows = await addTwoTracks()
      runMenu('process-all')
      await waitFor(() => expect(processTrack).toHaveBeenCalled())
      fireEvent.click(rows[0])
      expect(await screen.findByTestId('error-boundary')).toBeInTheDocument()
      expect(screen.getByTestId('batch-run-progress')).toHaveTextContent('Converting… 0/2')
      fireEvent.click(screen.getByTestId('batch-run-cancel'))
      expect(cancelJob).toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByTestId('batch-run')).toBeNull())
    } finally {
      vi.doUnmock('./components/Editor')
      vi.resetModules()
      silenced.mockRestore()
    }
  })
})
