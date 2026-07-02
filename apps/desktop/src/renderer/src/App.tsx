import { useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownNarrowWide,
  ArrowDownUp,
  ArrowUpNarrowWide,
  AudioLines,
  CaseSensitive,
  Clock,
  Crosshair,
  FileAudio,
  FilePlus,
  Replace,
  SquareCheckBig,
  Tag,
  Trash2,
  User,
} from 'lucide-react'
import type React from 'react'
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../shared/autoMatch'
import { DEFAULT_DISCOGS_MAX_RESULTS } from '../../shared/defaults'
import { emptyMetadata } from '../../shared/metadata'
import { resolveBindings } from '../../shared/shortcutDefaults'
import type {
  NormalizeConfig,
  OutputFormat,
  SearchProviderId,
  Settings,
  ThemePref,
  TrackMetadata,
} from '../../shared/types'
import { ActivityPanel } from './components/ActivityPanel'
import { Confetti } from './components/Confetti'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LivePlayer } from './components/Player'
import { QualityFilterBar } from './components/QualityFilterBar'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { SearchInput } from './components/SearchInput'
import { Select } from './components/Select'
import { ToastStack } from './components/ToastStack'
import { Toolbar } from './components/Toolbar'
import { Tooltip } from './components/Tooltip'
import { TopProgressBar } from './components/TopProgressBar'
import { TrackList } from './components/TrackList'
import { useActivityLog } from './hooks/useActivityLog'
import { useAutoMatch } from './hooks/useAutoMatch'
import { useConfirmFlows } from './hooks/useConfirmFlows'
import { useDockPlayingIndicator } from './hooks/useDockPlayingIndicator'
import { editorSectionOpen } from './hooks/useEditorSections'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useListNavigation } from './hooks/useListNavigation'
import { type SettingsTab, useOverlays } from './hooks/useOverlays'
import { usePlayer } from './hooks/usePlayer'
import { useQualityAnalysis } from './hooks/useQualityAnalysis'
import { useSettings } from './hooks/useSettings'
import { spectrogramOptions } from './hooks/useSpectrogram'
import { useStableCallback } from './hooks/useStableCallback'
import { useTrackLibrary } from './hooks/useTrackLibrary'
import { useTrackProcessing } from './hooks/useTrackProcessing'
import { useTracksView, type ViewCacheEntry } from './hooks/useTracksView'
import { waveformOptions } from './hooks/useWaveform'
import { nextLocale } from './i18n/locale'
import { removeAnalysisQueries } from './lib/analysisQueries'
import type { AppleMusicIndex } from './lib/appleMusicLibrary'
import { type AppError, type AppStore, createAppStore, useAppStore } from './lib/appStore'
import { tracksToAutoMatch } from './lib/autoMatch'
import { canProcessTrack, eligibleForBatch } from './lib/batch'
import { buildCommands, type Command, runCommand } from './lib/commands'
import { revokeCoverUrl, revokeCoverUrlIfUnused } from './lib/coverUrl'
import { smartDeriveTags } from './lib/deriveTags'
import { shouldShowDonateNudge } from './lib/donateNudge'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from './lib/fields'
import { shouldShowOnboarding } from './lib/onboarding'
import { renderOutputName } from './lib/outputName'
import { needsDiscogsPrefetch } from './lib/prefetch'
import { applyProgress, topBarProgress } from './lib/progress'
import type { ReleaseMetaPatch } from './lib/release'
import { contentDeficit } from './lib/resize'
import { type ClickMods, clickSelect, reanchorToVisible, type Selection } from './lib/selection'
import { formatShortcut } from './lib/shortcuts'
import { dismissToast, dismissToastByUser, pushToast } from './lib/toastQueue'
import {
  EMPTY_FILTER,
  type FilterSelection,
  filterWithSticky,
  formatBuckets,
  matchesSearch,
  qualityCounts,
  sortTracks,
  type TrackSort,
} from './lib/triage'
import type { TrackItem } from './types'

// On-demand overlays: none is part of the first paint (each renders only behind its
// activeModal branch), so each is split into its own chunk and kept out of the startup
// parse, loading the first time the user opens it. The .then unwraps the named export
// React.lazy needs as a default.
const SettingsModal = lazy(() =>
  import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })),
)
const OnboardingWizard = lazy(() =>
  import('./components/OnboardingWizard').then((m) => ({ default: m.OnboardingWizard })),
)
const DonateNudgeModal = lazy(() =>
  import('./components/DonateNudgeModal').then((m) => ({ default: m.DonateNudgeModal })),
)
const HelpModal = lazy(() =>
  import('./components/HelpModal').then((m) => ({ default: m.HelpModal })),
)
const LoudnessHelpModal = lazy(() =>
  import('./components/LoudnessHelpModal').then((m) => ({ default: m.LoudnessHelpModal })),
)
const FindReplaceModal = lazy(() =>
  import('./components/FindReplaceModal').then((m) => ({ default: m.FindReplaceModal })),
)
const RenameModal = lazy(() =>
  import('./components/RenameModal').then((m) => ({ default: m.RenameModal })),
)
const ExportModal = lazy(() =>
  import('./components/ExportModal').then((m) => ({ default: m.ExportModal })),
)
const CommandPalette = lazy(() =>
  import('./components/CommandPalette').then((m) => ({ default: m.CommandPalette })),
)

// Hovering counts as intent only after the cursor rests briefly, so sweeping the
// pointer across the list while scrolling doesn't fire a prefetch for every row.
const PREFETCH_HOVER_MS = 150

// Stable fallback while settings load, so the memoized Editor doesn't see a new array
// each render. Mirrors the persisted default (Discogs only).
const DEFAULT_SEARCH_PROVIDERS: SearchProviderId[] = ['discogs']

// Warms the main-process Discogs caches for a hovered track: the search the editor
// runs on open, plus the top release behind it. Both are cached by the main
// process, so opening the track (and clicking that release) then hits no network.
async function warmSearch(query: string): Promise<void> {
  // Background warming yields to the editor's own search, so it acquires at low priority.
  const results = await window.api.search(query, undefined, 'low')
  if (results[0]) await window.api.getRelease(results[0].id, undefined, 'low')
}

// Settings arrive null for the first frames; the fallback object must keep one
// identity or it defeats the editor's memo (a fresh object per render is a changed prop).
const DEFAULT_NORMALIZE: NormalizeConfig = {
  mode: 'none',
  targetLufs: -14,
  truePeakDb: -1,
  peakDb: -1,
}

// macOS shows ⌘; everywhere else the shortcuts fire on Ctrl and read as "Ctrl".
const isMac = window.api.platform === 'darwin'

// Stable empty default for the Discogs format filter, so a settings-less first frame
// doesn't hand the memoized Editor a fresh [] each render.
const EMPTY_FORMATS: string[] = []

export default function App(): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null })
  const selectedId = selection.anchor
  const selectedIds = selection.ids
  // A Set for the list's per-row membership test, so the parent's "is this row selected?"
  // pass is O(1) per row instead of Array.includes scanning the whole selection for each
  // of N rows (O(N·selection) on a large multi-selection).
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // The single-overlay state machine (which modal is open) and its typed openers/closers.
  const overlays = useOverlays()
  const activeModal = overlays.activeModal
  // UI-orchestration state (search, sort, filter, notices, drag, copied tags…) lives in a
  // small per-mount external store so stable callbacks read the latest value via getState()
  // instead of a ref-mirror; the field comments live in appStore. Lazily created so the
  // factory runs once, not once per render.
  const storeRef = useRef<AppStore | null>(null)
  if (storeRef.current === null) storeRef.current = createAppStore()
  const store = storeRef.current
  const toasts = useAppStore(store, (s) => s.toasts)
  const expireToast = useCallback((id: string) => dismissToast(store, id), [store])
  const closeToast = useCallback((id: string) => dismissToastByUser(store, id), [store])
  // A transient neutral status line (e.g. "skipped N already-added files") that clears itself
  // on a 4s timer so it never lingers after the user has moved on.
  const setNotice = useCallback(
    (message: string) =>
      pushToast(store, { tone: 'neutral', message, duration: 4000, testid: 'app-notice' }),
    [store],
  )
  // A surfaced background failure: red, keyed so a repeat collapses onto one card, and
  // persistent (no duration) since the user should see it before it goes.
  const setAppError = useCallback(
    (e: AppError) =>
      pushToast(store, {
        key: 'app-error',
        tone: 'danger',
        message: tr(`errors.${e.kind}`, { detail: e.detail ?? '' }),
        testid: 'app-error',
      }),
    [store, tr],
  )
  // The activity log: always-accumulating feed of background work, shown in a
  // movable floating panel the user toggles.
  const { rows: activityRows, clear: clearActivity } = useActivityLog()
  const [activityOpen, setActivityOpen] = useState(false)
  // Persisted settings (initial load, modal-open refresh, theme application,
  // optimistic save) live in the hook; App only decides the launch modal.
  const settingsOpen = activeModal?.type === 'settings'
  const { settings, setSettings, saveSettings, setThemePreview } = useSettings({
    settingsOpen,
    onFirstLoad: (s) => {
      if (shouldShowOnboarding(s)) overlays.openOnboarding()
    },
    onLoadError: () => setAppError({ kind: 'settingsLoad' }),
    onSaveError: () => setAppError({ kind: 'settingsSave' }),
  })
  // Evaluated after a conversion run — the moment of value, when the savings summary
  // means something. Re-reads settings so the conversion just recorded in main is
  // counted and the modal shows the live total; never stomps an open modal. The
  // showing is stamped immediately (not on close) so a quick quit still counts toward
  // the cooldown and it can never appear twice in a row.
  const maybeShowDonateNudge = useStableCallback(async () => {
    if (activeModal !== null) return
    const s = await window.api.getSettings()
    if (!shouldShowDonateNudge(s, new Date(), Math.random())) return
    setSettings(s)
    overlays.openDonateNudge()
    void window.api.saveSettings({ donateNudgeLastShown: new Date().toISOString() })
  })
  // Quality triage filter, free-text search and display order — read from the store with a
  // stable setter each (field comments live in appStore).
  const qualityFilter = useAppStore(store, (s) => s.qualityFilter)
  const conversionFilter = useAppStore(store, (s) => s.conversionFilter)
  const libraryFilter = useAppStore(store, (s) => s.libraryFilter)
  const formatFilter = useAppStore(store, (s) => s.formatFilter)
  // The four filter axes bundled for the bar, which toggles one per click; split back onto
  // the store fields here so each axis stays an independently-readable slice.
  const filterSelection = useMemo<FilterSelection>(
    () => ({
      quality: qualityFilter,
      conversion: conversionFilter,
      library: libraryFilter,
      format: formatFilter,
    }),
    [qualityFilter, conversionFilter, libraryFilter, formatFilter],
  )
  const filterActive =
    qualityFilter !== null ||
    conversionFilter !== null ||
    libraryFilter !== null ||
    formatFilter !== null
  const setFilterSelection = useCallback(
    (next: FilterSelection) =>
      store.setState({
        qualityFilter: next.quality,
        conversionFilter: next.conversion,
        libraryFilter: next.library,
        formatFilter: next.format,
      }),
    [store],
  )
  const setFormatFilter = useCallback(
    (f: string | null) => store.setState({ formatFilter: f }),
    [store],
  )
  const search = useAppStore(store, (s) => s.search)
  const setSearch = useCallback((v: string) => store.setState({ search: v }), [store])
  // The text box stays driven by `search` (instant keystrokes); the expensive filter/sort
  // pass below keys off the deferred value so typing in a large crate never blocks paint.
  const deferredSearch = useDeferredValue(search)
  const sortBy = useAppStore(store, (s) => s.sortBy)
  // Picking a sort key resets to ascending, so a freshly-chosen column reads top-down
  // rather than inheriting the previous column's reversed direction.
  const setSortBy = useCallback(
    (v: TrackSort) => store.setState({ sortBy: v, sortDir: 'asc' }),
    [store],
  )
  const sortDir = useAppStore(store, (s) => s.sortDir)
  const toggleSortDir = useCallback(
    () => store.setState({ sortDir: store.getState().sortDir === 'asc' ? 'desc' : 'asc' }),
    [store],
  )
  const dragging = useAppStore(store, (s) => s.dragging)
  const setDragging = useCallback((d: boolean) => store.setState({ dragging: d }), [store])
  const copiedMeta = useAppStore(store, (s) => s.copiedMeta)
  const setCopiedMeta = useCallback(
    (m: TrackMetadata | null) => store.setState({ copiedMeta: m }),
    [store],
  )
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The sidebar's track-filter field, focused by the `/` shortcut. Separate from
  // searchInputRef (the editor's Discogs box) so `/` filters the list rather than
  // jumping focus into the editor.
  const trackSearchRef = useRef<HTMLInputElement>(null)
  // The scrolling track-list pane, handed to the rows as their IntersectionObserver root so
  // "on screen" means within this pane, not the whole window.
  const listScrollRef = useRef<HTMLDivElement>(null)
  // Row buttons by track id, registered by the list. Keyboard navigation and the
  // sidebar auto-fit look rows up here instead of querying test ids out of the DOM —
  // a runtime dependency on DOM order that would break silently under virtualization.
  const rowEls = useRef(new Map<string, HTMLButtonElement>())
  // The list's sticky filter header, measured when paging the scroll position.
  const qualityFilterRef = useRef<HTMLDivElement>(null)
  // Refs so the prefetch callback can stay stable (memoized rows depend on it)
  // while still reading the latest spectrum/token settings on each hover.
  const showSpectrumRef = useRef(true)
  showSpectrumRef.current = settings?.showSpectrum ?? true
  const showWaveformRef = useRef(true)
  showWaveformRef.current = settings?.showWaveform ?? true
  const hasTokenRef = useRef(false)
  hasTokenRef.current = !!settings?.discogsToken
  // Live providers for the background sweep, read at probe time (Settings → Search).
  const searchProvidersRef = useRef<SearchProviderId[]>(DEFAULT_SEARCH_PROVIDERS)
  searchProvidersRef.current = settings?.searchProviders ?? DEFAULT_SEARCH_PROVIDERS
  // Live view of the Apple Music library snapshot for the sweep, kept current below once
  // useTracksView has computed it (the sweep reads it at apply time, not at render).
  const libraryIndexRef = useRef<AppleMusicIndex | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()
  // The latest spectrum-merged view of the tracks, so the hover-prefetch and analyze
  // callbacks (which read refs to stay stable) can see each track's cached spectrum
  // without re-subscribing.
  const tracksViewRef = useRef<TrackItem[]>([])
  // The current visible (filtered/sorted/searched) order, so the stable select callback
  // resolves a Shift range over what's on screen rather than the full import order.
  const visibleTracksRef = useRef<TrackItem[]>([])
  // The rows pinned into the current library-filter view, so a background auto-match that
  // flips a row's "already owned" verdict can't drop it out from under the user mid-work
  // (see filterWithSticky). Tied to the filter it was built for: switching filter (or
  // re-clicking the same chip) resets it, which is the deliberate "refresh" that
  // recomputes membership from the live verdicts.
  const stickyFilter = useRef<string>('')
  const stickyIds = useRef<Set<string>>(new Set())
  // Merging a cached spectrum onto a track mints a new object; caching it by id keeps
  // the reference stable across renders so memoized rows only re-render when their own
  // spectrum lands. Owned here (not in useTracksView) so the track-removal callbacks
  // below can evict an entry as its row leaves.
  const viewCache = useRef(new Map<string, ViewCacheEntry>())
  // Marks tracks whose Discogs caches are warmed (or warming) so a second hover
  // never re-runs the search; cleared on failure so a transient error can retry.
  const discogsPrefetched = useRef<Set<string>>(new Set())
  // The format picked in the editor's split-button menu, so the keyboard convert
  // shortcuts export in it too. The editor reports its pick on every change AND its
  // seed on mount (it remounts per track), so this mirror is right by construction;
  // null only before any editor has mounted, falling back to the Settings default.
  const editorFormatRef = useRef<OutputFormat | null>(null)
  // Per-track normalization override picked in the editor, mirroring editorFormatRef.
  const editorNormalizeRef = useRef<NormalizeConfig | null>(null)

  // IPC promises rejected outside any catch (shell calls, fire-and-forget writes)
  // would otherwise vanish into the devtools console — a failure indistinguishable
  // from success. Surface them.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent): void => {
      setAppError({
        kind: 'unexpected',
        detail: e.reason instanceof Error ? e.reason.message : String(e.reason),
      })
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [setAppError])

  // The native menu triggers actions by command id, the same registry the
  // palette and keyboard shortcuts use, so the three surfaces never drift apart.
  // Opening the palette is the one exception: it's a UI affordance, not a track
  // command, so it never lists itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: subscribe-once listener; getCommands and overlays.openPalette have stable identities (getCommands is declared below, so it can't go in the deps), and getCommands is called at fire time for the current registry.
  useEffect(
    () =>
      window.api.onMenuCommand((id) => {
        if (id === 'palette') overlays.openPalette()
        else runCommand(getCommands(), id)
      }),
    [],
  )

  // The track collection (import pipeline, write paths, removal) lives in the hook;
  // App supplies the per-track registry cleanup and the auto-match opt-in, which is
  // gated on a token and only fires once a file's own metadata is read so the search
  // has a query. Queued visible-only, so a big folder probes the rows in view as they
  // scroll past rather than firing every file at the rate limit.
  const {
    tracks,
    pendingNew,
    loadPending,
    dismissPending,
    importProgress,
    setTracks,
    tracksRef,
    addPaths,
    pickFiles,
    updateTrack,
    updateTracksMeta,
    patchTracks,
    deriveTracks,
    startOverTrack,
    removeTrack,
    removeTracks,
    clearTracks,
  } = useTrackLibrary({
    setSelection,
    onForget: (id) => {
      discogsPrefetched.current.delete(id)
      viewCache.current.delete(id)
      forgetAutoMatch(id)
      // Free the rebuilt row's old blob only if no other track still shows it.
      revokeCoverUrlIfUnused(
        tracksRef.current.find((t) => t.id === id)?.coverUrl,
        tracksRef.current.filter((t) => t.id !== id).map((t) => t.coverUrl),
      )
    },
    // A row leaving the list also evicts its probe results from the session-long
    // query cache, where the spectrogram image would otherwise be retained until quit.
    onRemove: (track) => {
      discogsPrefetched.current.delete(track.id)
      viewCache.current.delete(track.id)
      forgetAutoMatch(track.id)
      removeAnalysisQueries(queryClient, track.inputPath)
      // A picked cover's blob URL would otherwise pin the image file until quit — but a
      // cover applied across a selection is shared, so keep it while another row uses it.
      revokeCoverUrlIfUnused(
        track.coverUrl,
        tracksRef.current.filter((t) => t.id !== track.id).map((t) => t.coverUrl),
      )
    },
    onClear: (cleared) => {
      discogsPrefetched.current.clear()
      viewCache.current.clear()
      resetAutoMatch()
      for (const t of cleared) {
        removeAnalysisQueries(queryClient, t.inputPath)
        revokeCoverUrl(t.coverUrl)
      }
    },
    onMetaLoaded: (t) => {
      // Enqueue visible-only: with auto-match on, an imported track is probed once its row
      // is actually on screen, so an active filter holds back the rows it hides. Change the
      // filter and the newly-shown rows get matched; already-matched ones are never re-probed.
      if (settings?.autoMatch && autoMatchAvailable(settings)) enqueueAutoMatch([t], true)
    },
    onDuplicatesSkipped: (count) => setNotice(tr('notices.duplicatesSkipped', { count })),
  })

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [setTracks],
  )

  // The watcher's "N new tracks" prompt rides the same queue as every other toast: keyed so a
  // second copy-in updates the count in place, persistent so it waits for an answer, and with
  // a Load action that adds the tracks. Re-pushed whenever the pending set changes; dismissed
  // when it clears (the user accepted, or the crate was emptied).
  useEffect(() => {
    if (!pendingNew) return
    const folder = pendingNew.root.split('/').pop() || pendingNew.root
    const id = pushToast(store, {
      key: 'new-tracks',
      tone: 'neutral',
      testid: 'new-tracks',
      message: tr('newTracks.prompt', { count: pendingNew.paths.length, folder }),
      action: { label: tr('newTracks.load'), onAction: loadPending },
      onDismiss: dismissPending,
    })
    return () => dismissToast(store, id)
  }, [pendingNew, loadPending, dismissPending, store, tr])

  // The auto-updater reports a downloaded version (or a download failure) over IPC; surface
  // each as a toast instead of a bespoke component. The ready prompt offers Restart (applies
  // it immediately); a failure is a plain danger toast. Keyed so a retry supersedes the stale
  // one rather than stacking.
  useEffect(
    () =>
      window.api.onUpdateDownloaded((version) =>
        pushToast(store, {
          key: 'update',
          tone: 'neutral',
          testid: 'update',
          message: tr('update.ready', { version }),
          action: { label: tr('update.restart'), onAction: () => window.api.installUpdate() },
        }),
      ),
    [store, tr],
  )
  useEffect(
    () =>
      window.api.onUpdateError((error) =>
        pushToast(store, {
          key: 'update',
          tone: 'danger',
          testid: 'update-error',
          message: tr('update.failed', { error }),
        }),
      ),
    [store, tr],
  )

  const onSelectTrack = useCallback((id: string, mods: ClickMods): void => {
    const order = visibleTracksRef.current.map((t) => t.id)
    setSelection((s) => clickSelect(s, order, id, mods))
  }, [])

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f))
    addPaths(await window.api.expandPaths(dropped))
  }

  // Warms a hovered track's spectrum and waveform so opening it is instant. Debounced
  // (the row only counts as intent once the cursor rests). prefetchQuery skips a track
  // already in the cache and dedups concurrent hovers, so it needs no in-flight guard.
  const handlePrefetch = useCallback(
    (id: string): void => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      hoverTimer.current = setTimeout(() => {
        const track = tracksRef.current.find((t) => t.id === id)
        if (!track) return
        // The player shows the waveform the moment playback opens it, and it is the heaviest
        // decode (whole file), so warm it for every rested hover — unless the user collapsed
        // the strip, in which case the player won't show it and warming would waste the very
        // decode the toggle exists to avoid.
        if (showWaveformRef.current) {
          void queryClient.prefetchQuery(waveformOptions(track.inputPath))
        }
        // Skip the spectrogram when the quality section is folded away: warming it would
        // run the heavy ffmpeg decode the user folded the section to avoid, and the
        // editor wouldn't show it anyway. Reopening the section runs the analysis then.
        if (showSpectrumRef.current && editorSectionOpen('quality')) {
          void queryClient.prefetchQuery(spectrogramOptions(track.inputPath))
        }
        if (
          needsDiscogsPrefetch(track, hasTokenRef.current) &&
          !discogsPrefetched.current.has(id)
        ) {
          discogsPrefetched.current.add(id)
          warmSearch(track.query).catch(() => discogsPrefetched.current.delete(id))
        }
      }, PREFETCH_HOVER_MS)
    },
    [queryClient, tracksRef],
  )

  // Batch quality triage (progress, cancel, focus gating) lives in the hook; App only
  // wires the start/cancel actions into the toolbar and commands.
  const { analysis, analyzeAllQuality, cancelAnalysis } = useQualityAnalysis({
    // The visible (filtered) rows, so the sweep analyses what's shown — change the filter and
    // the next run reaches the newly-visible tracks. Already-measured ones are skipped, so
    // widening the filter never re-analyses what a narrower one already did.
    targetsRef: visibleTracksRef,
    onErrors: (count) => setNotice(tr('notices.qualityErrors', { count })),
  })

  // The Discogs auto-match sweep: queue, visibility gating, pump and progress live in
  // the hook; App only wires enqueue/cancel into the import flow, toolbar and commands.
  const {
    matching,
    enqueueAutoMatch,
    onTrackVisible,
    cancelAutoMatch,
    forgetTrack: forgetAutoMatch,
    reset: resetAutoMatch,
    focusTrack: focusAutoMatch,
  } = useAutoMatch({ tracksRef, updateTrack, libraryIndexRef, searchProvidersRef })

  // Whatever row is selected jumps to the front of the auto-match sweep (and onto Discogs'
  // high-priority lane), so the track you're looking at resolves now instead of waiting its
  // turn behind a freshly dropped crate.
  useEffect(() => {
    focusAutoMatch(selectedId)
  }, [selectedId, focusAutoMatch])

  // With auto-match on, the track you're viewing shouldn't need the toolbar button: once
  // the selection rests on a row, enqueue it just like an import would. Already-matched
  // tracks are filtered out downstream, so revisiting one never re-probes. Debounced so
  // arrowing through a crate doesn't fire a Discogs probe per row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the exact settings fields autoMatchAvailable reads (autoMatch/discogsToken/searchProviders), not settings' identity — depending on the whole object would re-run the debounce on unrelated settings changes; tracksRef is read fresh.
  useEffect(() => {
    if (!selectedId || !settings?.autoMatch || !autoMatchAvailable(settings)) return
    const id = setTimeout(() => {
      const track = tracksRef.current.find((t) => t.id === selectedId)
      if (track) enqueueAutoMatch([track], false)
    }, 500)
    return () => clearTimeout(id)
  }, [
    selectedId,
    settings?.autoMatch,
    settings?.discogsToken,
    settings?.searchProviders,
    enqueueAutoMatch,
    tracksRef,
  ])

  // Turning auto-match off in Settings must stop the running sweep outright — cancel the
  // in-flight probes and empty the queue, or a later scroll would quietly resume matching
  // the rows that were still pending.
  useEffect(() => {
    if (!settings?.autoMatch) cancelAutoMatch()
  }, [settings?.autoMatch, cancelAutoMatch])

  // Right-click "Search Discogs": make the track active, then focus the search box on the
  // next tick once the editor for the new selection has mounted and bound the ref.
  const onSearchTrack = useCallback(
    (id: string): void => {
      onSelectTrack(id, {})
      setTimeout(() => searchInputRef.current?.focus(), 0)
    },
    [onSelectTrack],
  )

  // The right-click menu keeps a multi-selection intact (TrackList only re-selects an
  // unselected row), so its list actions — remove, trash — act on the whole selection
  // when the clicked row is part of it, matching what's highlighted, and fall back to the
  // single clicked row otherwise.
  const menuTargets = useCallback(
    (id: string): TrackItem[] =>
      selectedIds.includes(id) && selectedIds.length > 1
        ? tracks.filter((t) => selectedIds.includes(t.id))
        : tracks.filter((t) => t.id === id),
    [tracks, selectedIds],
  )

  const removeFromList = useCallback(
    (id: string): void => {
      for (const t of menuTargets(id)) removeTrack(t.id)
    },
    [menuTargets, removeTrack],
  )

  function selectAll(): void {
    // Acts on the visible (filtered) rows, not the whole crate: a DJ who filters to MP3 and
    // hits Select All expects only those — sweeping in the hidden FLAC/WAV rows would then
    // convert tracks they never saw. Read through the ref so this stays the latest filtered
    // set without threading visibleTracks (declared below) into the function's closure.
    const visible = visibleTracksRef.current
    if (visible.length === 0) return
    // Toggle: with every visible row already selected, a second press clears the selection
    // rather than re-selecting the same set — one control both selects all and deselects all.
    if (selectedIds.length === visible.length && visible.every((t) => selectedIds.includes(t.id))) {
      setSelection({ ids: [], anchor: null })
      return
    }
    setSelection({ ids: visible.map((t) => t.id), anchor: visible[0].id })
  }

  const {
    processOne,
    processAll,
    addTrackToAppleMusic,
    addAllToAppleMusic,
    batching,
    batchProgress,
    batchSummary,
  } = useTrackProcessing({
    tracks,
    settings,
    updateTrack,
    onConversion: maybeShowDonateNudge,
    onNormalizeSkipped: (name) => setNotice(tr('notices.normalizeSkipped', { name })),
  })

  // Emptying every row starts over — clearTracks also drops the folder watcher. Emptying just
  // the filtered-visible subset removes those rows and keeps watching, so the hidden FLAC/WAV
  // tracks survive the click.
  const emptyTracks = useStableCallback((targets: TrackItem[]) => {
    if (targets.length === tracksRef.current.length) clearTracks()
    else removeTracks(targets.map((t) => t.id))
  })

  // The confirm-before-firing actions (trash, delete original, fill-all, clear-all,
  // in-place convert-all): each builds its dialog and wires onConfirm into the data layer.
  const { askTrash, askDeleteOriginal, askFillAll, askClearAll, askConvertAll } = useConfirmFlows({
    settings,
    removeTrack,
    updateTrack,
    emptyTracks,
    deriveTracks,
    processAll,
    openConfirm: overlays.openConfirm,
    reportTrashFailure: (fileName) => setAppError({ kind: 'trash', detail: fileName }),
  })

  const openSettings = (tab: SettingsTab = 'general'): void => overlays.openSettings(tab)

  function closeSettings(): void {
    overlays.close()
    setThemePreview(null)
  }

  function finishOnboarding(patch: Partial<Settings>): void {
    saveSettings(patch)
    overlays.close()
  }

  const sidebar = useResizableWidth(300, 300, 600)

  // Double-clicking the divider fits the list to its tracks: measure how far each title and
  // artist is clipped (or has to spare) and resize by the widest, so long names stop
  // truncating without the user dragging — and an over-wide column tightens back up.
  const autoFitSidebar = useCallback((): void => {
    const rows = []
    for (const el of rowEls.current.values()) {
      const span = el.querySelector<HTMLElement>('[data-fit]')
      if (span) rows.push({ scrollWidth: span.scrollWidth, clientWidth: span.clientWidth })
    }
    sidebar.autoFit(contentDeficit(rows))
  }, [sidebar.autoFit])

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  // With nothing selected there is no editor reporting picks; the convert-all
  // shortcut then falls back to the Settings defaults.
  if (!selected) {
    editorFormatRef.current = null
    editorNormalizeRef.current = null
  }
  // Filtering mints a new array per tracks change even when none of the SELECTED
  // tracks changed (a progress tick on another row). Keeping the previous identity in
  // that case is what lets the memoized Editor skip those renders entirely.
  const prevSelectedTracks = useRef<TrackItem[]>([])
  const selectedTracks = useMemo(() => {
    const next = tracks.filter((t) => selectedIds.includes(t.id))
    const prev = prevSelectedTracks.current
    const unchanged = prev.length === next.length && next.every((t, i) => t === prev[i])
    if (!unchanged) prevSelectedTracks.current = next
    return prevSelectedTracks.current
  }, [tracks, selectedIds])
  // The floating player (audio element, visibility, follow-selection playback)
  // lives in the hook; App renders the <audio> element and the card.
  const { audioRef, playerVisible, playerTrack, togglePlay, toggleTrack, closePlayer } = usePlayer({
    tracks,
    selected,
    selectedId,
  })
  // While audio plays, the Dock icon's engraved wave animates (macOS only).
  useDockPlayingIndicator(audioRef)

  const canProcessSelected =
    !!selected && canProcessTrack(selected, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  const eligibleCount = useMemo(
    () => eligibleForBatch(tracks, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS).length,
    [tracks, settings?.requiredFields],
  )

  // Merges each track's cached spectrum and Apple Music verdict onto it (identity-stable
  // via viewCache), driving the quality triage, the list and the editor's library badge.
  const { tracksView, libraryIndex } = useTracksView(tracks, viewCache)
  tracksViewRef.current = tracksView
  // Feed the snapshot to the background sweep so it can re-check ownership against each
  // match's canonical metadata (the sweep reads .current at apply time, not at render).
  libraryIndexRef.current = libraryIndex

  const qualityTally = useMemo(() => qualityCounts(tracksView), [tracksView])
  const formatTally = useMemo(() => formatBuckets(tracksView), [tracksView])
  // The format filter is tied to the crate's contents (unlike the deliberately-sticky
  // Apple Music buckets): once its format is no longer present — the last MP3 removed, or
  // the crate gone single-format — fall back to every format so the user is never stranded
  // on an empty, no-longer-offered refinement.
  useEffect(() => {
    if (formatFilter && !formatTally.some((f) => f.format === formatFilter)) {
      setFormatFilter(null)
    }
  }, [formatTally, formatFilter, setFormatFilter])
  const visibleTracks = useMemo(() => {
    // Reset the pinned set the moment any filter axis changes, so each filter session
    // starts from the live verdicts; within a session filterWithSticky keeps already-shown
    // library rows put even after a background auto-match flips their verdict.
    const { quality, conversion, library, format } = filterSelection
    const key = `${quality ?? ''}|${conversion ?? ''}|${library ?? ''}|${format ?? ''}`
    if (stickyFilter.current !== key) {
      stickyFilter.current = key
      stickyIds.current = new Set()
    }
    return sortTracks(
      filterWithSticky(tracksView, filterSelection, stickyIds.current).filter((t) =>
        matchesSearch(t, deferredSearch),
      ),
      sortBy,
      sortDir,
    )
  }, [tracksView, filterSelection, deferredSearch, sortBy, sortDir])
  // The display order a Shift-click ranges over, read by the (ref-stable) select callback
  // so a range spans the rows the user actually sees — not the import order, which would
  // sweep in tracks hidden by the active filter, sort or search.
  visibleTracksRef.current = visibleTracks
  // Find & Replace overwrites text tags across many rows, so it obeys the same rule as the
  // other bulk actions: a deliberate multi-selection when there is one, else the visible
  // (filtered) rows — never the tracks the active filter is hiding. Reactive (not the ref
  // bulkActionTarget uses) because the open modal re-previews live as the set changes.
  const findReplaceTargets = useMemo(
    () => (selectedTracks.length > 1 ? selectedTracks : visibleTracks),
    [selectedTracks, visibleTracks],
  )
  // Keyboard / continuous-playback navigation over the visible list (move + scroll paging).
  const {
    moveSelection,
    jumpSelection,
    pageSelection,
    revealSelection,
    scrollToSelected,
    onTrackEnded,
  } = useListNavigation({
    visibleTracks,
    selectedId,
    setSelection,
    continuousPlayback: settings?.continuousPlayback ?? false,
    playerVisible,
    playerTrack,
    closePlayer,
    rowEls,
    listScrollRef,
    qualityFilterRef,
  })
  // 1-based position of the selected row within the current view, for the "54/200" pill —
  // so a DJ auditioning a crate one by one sees how far along they are. Null when nothing
  // is selected (or the selection was filtered out of view).
  const selectedPosition = useMemo(() => {
    if (!selectedId) return null
    const i = visibleTracks.findIndex((t) => t.id === selectedId)
    return i < 0 ? null : i + 1
  }, [visibleTracks, selectedId])
  // A filter change (quality bucket or format axis) can hide the selected track; left alone
  // its editor lingers out of view and the position pill reads "‒/N". Drop to the first
  // track the new filter shows (or clear when it shows none) so the editor and count always
  // reflect what's on screen. Must react to BOTH filter axes — the format filter hiding the
  // selection used to leave the list with no visible row selected. Scoped to the filters —
  // not search, which changes per keystroke and would thrash the editor's per-track fetches;
  // sort only reorders, never hides.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to filter changes only; visibleTracks and selectedId are read from the latest render.
  useEffect(() => {
    const next = reanchorToVisible(
      visibleTracks.map((t) => t.id),
      selectedId,
    )
    if (next) setSelection(next)
  }, [filterSelection])
  // Drives the toolbar auto-match button: how many visible tracks are still worth a probe, so
  // it disables once every shown track is matched, and changing the filter to reveal unmatched
  // rows re-enables it. Scoped to the visible set because the sweep matches only those.
  const autoMatchable = useMemo(() => tracksToAutoMatch(visibleTracks).length, [visibleTracks])
  const canProcessAll = eligibleCount > 0 && !batching

  // Effective key bindings (defaults + the user's overrides): the single source the
  // palette hints below and the keydown listener (via a ref, since it subscribes once)
  // both read, so a rebind in Settings updates everywhere at once.
  const bindings = useMemo(
    () => resolveBindings(settings?.shortcutOverrides),
    [settings?.shortcutOverrides],
  )
  const hintFor = (id: string): string => formatShortcut(bindings.get(id) ?? [], isMac)

  // Every handler handed to the memoized Toolbar/Editor goes through
  // useStableCallback: one identity for the child's memo, the latest closure for the
  // call — so an inline-style body can still read current state.
  const onAdd = useStableCallback(() => void pickFiles())
  const onSelectAllTracks = useStableCallback(selectAll)
  // The toolbar bulk actions (fill, empty) act on the visible (filtered) rows — never the
  // whole list behind an active filter, and never scoped to the selection: the toolbar mirrors
  // what's on screen, so a click can't touch rows the user filtered out of view. Removing only
  // a few rows is the right-click menu's "Remove from list"; wiping the entire list regardless
  // of filter is the palette's "Clear the list".
  const onFillAll = useStableCallback(() => askFillAll(visibleTracksRef.current))
  const onFindReplace = useStableCallback(overlays.openFindReplace)
  const onAnalyzeAll = useStableCallback(analyzeAllQuality)
  const onAutoMatchAll = useStableCallback(() => enqueueAutoMatch(visibleTracks, false))
  const onOpenExport = useStableCallback(overlays.openExport)
  const onClearAll = useStableCallback(() => askClearAll(visibleTracksRef.current))
  // The palette's "Clear the list" is the deliberate start-over: it wipes every track,
  // including the ones an active format filter is hiding, unlike the toolbar trash button.
  const onClearEverything = useStableCallback(() => askClearAll(tracksRef.current))
  const onOpenPalette = useStableCallback(overlays.openPalette)
  const onOpenStats = useStableCallback(() => openSettings('stats'))
  const onOpenSettings = useStableCallback(openSettings)
  const onApplyMatches = useStableCallback((patches: { id: string; patch: ReleaseMetaPatch }[]) => {
    for (const p of patches) updateTrack(p.id, { ...p.patch, matched: true })
  })
  const onProcessAllSelected = useStableCallback((format: OutputFormat) =>
    askConvertAll(selectedTracks, format, editorNormalizeRef.current ?? undefined),
  )
  const onAddAllSelectedToAppleMusic = useStableCallback(() => void addAllToAppleMusic(selectedIds))
  const onChangeAllMeta = useStableCallback((patch: Partial<TrackMetadata>) =>
    updateTracksMeta(selectedIds, patch),
  )
  // Copy a track's whole tag set, then stamp it onto whichever track the user pastes
  // onto — the fast way to share release-level metadata across a crate.
  const onCopyMeta = useStableCallback((track: TrackItem) => setCopiedMeta(track.meta))
  const onPasteMeta = useStableCallback((track: TrackItem) => {
    if (copiedMeta) updateTracksMeta([track.id], copiedMeta)
  })
  const onApplyCoverAll = useStableCallback((coverUrl: string, coverPath?: string) => {
    const ids = new Set(selectedIds)
    const displaced = tracksRef.current.filter((t) => ids.has(t.id)).map((t) => t.coverUrl)
    patchTracks(selectedIds, { coverUrl, coverPath })
    // The selected tracks just took the new cover; free each old blob only if no
    // unselected track still shows it (a prior apply-to-all can share one blob).
    const kept = tracksRef.current.filter((t) => !ids.has(t.id)).map((t) => t.coverUrl)
    for (const old of new Set(displaced)) revokeCoverUrlIfUnused(old, kept)
  })
  const onEditorChange = useStableCallback((patch: Partial<TrackItem>) => {
    if (!selected) return
    // A cover change or removal may strand the selected track's old blob; free it only
    // if no other track still references it.
    if ('coverUrl' in patch && patch.coverUrl !== selected.coverUrl)
      revokeCoverUrlIfUnused(
        selected.coverUrl,
        tracksRef.current.filter((t) => t.id !== selected.id).map((t) => t.coverUrl),
      )
    updateTrack(selected.id, patch)
  })
  // Converting a single track is the donate nudge's moment of value, so every entry
  // point to it must run through here — the Editor's convert button and the
  // process-current command/shortcut alike — or the same action nudges from one and
  // stays silent from the other.
  const convertSelected = useStableCallback(
    async (id: string, format?: OutputFormat, normalize?: NormalizeConfig) => {
      const outcome = await processOne(id, format, normalize)
      if (outcome === 'converted') void maybeShowDonateNudge()
      return outcome
    },
  )
  const onProcessSelected = useStableCallback(async (format: OutputFormat) => {
    if (selected)
      await convertSelected(selected.id, format, editorNormalizeRef.current ?? undefined)
  })
  const onFormatChange = useStableCallback((format: OutputFormat) => {
    editorFormatRef.current = format
  })
  const onNormalizeChange = useStableCallback((n: NormalizeConfig) => {
    editorNormalizeRef.current = n
  })
  const onAddSelectedToAppleMusic = useStableCallback(() => {
    if (selected) void addTrackToAppleMusic(selected.id)
  })
  const onTrashOriginal = useStableCallback(() => {
    if (selected) askDeleteOriginal(selected)
  })
  const onShowLoudnessHelp = useStableCallback(overlays.openLoudnessHelp)
  const onOpenRename = useStableCallback(overlays.openRename)
  const onRegenerateName = useStableCallback(() => {
    if (!selected) return
    const name = renderOutputName(settings?.filenameFormat ?? '{artist} - {title}', selected.meta)
    if (name) updateTrack(selected.id, { outputName: name })
  })
  // Copies the Settings-pattern name to the OS clipboard so the user can paste the track
  // into Google or Soulseek. A "/" in the pattern means a subfolder, so drop everything but
  // the last segment — the file name, not its directory, is what you search for.
  const onCopyFilename = useStableCallback(() => {
    if (!selected) return
    const name = renderOutputName(settings?.filenameFormat ?? '{artist} - {title}', selected.meta)
    if (name) void window.api.copyText(name.split('/').pop() ?? name)
  })
  // ⌘K twins of the Editor's Eraser / Tag buttons, acting on the current selection so they
  // work without the editor focused. clearMeta mirrors clearAllMeta (single-track clear also
  // un-matches and re-probes); deriveTags mirrors deriveFromNames over the selection.
  const clearMeta = useStableCallback(() => {
    if (!selected) return
    if (selectedTracks.length > 1) updateTracksMeta(selectedIds, emptyMetadata())
    else
      updateTrack(selected.id, {
        meta: emptyMetadata(),
        matched: false,
        matchReview: false,
        inAppleMusicResolved: false,
      })
  })
  const deriveTags = useStableCallback(() => {
    const targets = selectedTracks.length > 1 ? selectedTracks : selected ? [selected] : []
    const patches = targets
      .map((f) => ({ id: f.id, meta: smartDeriveTags(f.fileName) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) deriveTracks(patches)
  })
  // Rotates system → light → dark and persists it, the palette twin of the Settings control.
  const toggleTheme = useStableCallback(() => {
    const order: ThemePref[] = ['system', 'light', 'dark']
    const current = settings?.theme ?? 'system'
    saveSettings({ theme: order[(order.indexOf(current) + 1) % order.length] })
  })
  // A remount-keyed confetti burst: bumping the key mounts a fresh <Confetti>, so the ⌘K
  // command can fire it again and again. The burst tears itself down once it settles.
  const [confettiBurst, setConfettiBurst] = useState(0)
  const fireConfetti = useStableCallback(() => setConfettiBurst((n) => n + 1))
  // Gates the Analyze button: the sweep works on the visible rows, so it's "done" (disabled)
  // once every visible row is measured — not the hidden ones. Change the filter to reveal
  // unanalysed tracks and the button re-enables. O(N), memoised over the visible set.
  const allAnalyzed = useMemo(
    () => visibleTracks.every((t) => Boolean(t.spectrum)),
    [visibleTracks],
  )

  // Move keyboard focus between the three columns. The targets are found by their stable
  // data-testid (the same approach the Discogs panel already uses for autofit) rather than
  // threading a ref down through Editor → DiscogsPanel/MetadataForm: list = the roving tab
  // stop, matches = the first Discogs result (or its search box), editor = the title field.
  const focusList = (): void =>
    document.querySelector<HTMLElement>('[data-testid="track-row"][tabindex="0"]')?.focus()
  const focusMatches = (): void =>
    (
      document.querySelector<HTMLElement>('[data-testid="discogs-result"]') ??
      document.querySelector<HTMLElement>('[data-testid="discogs-query"]')
    )?.focus()
  const focusEditor = (): void =>
    document.querySelector<HTMLElement>('[data-testid="field-title"]')?.focus()

  // The command registry is data, rebuilt from the current state each time it's read.
  // Built lazily through a stable getter (rather than every render) because its only
  // readers are rare: a fired menu/keyboard command, and the palette while it's open.
  // useStableCallback keeps one identity while reading the latest closure, so the 27
  // i18n + shortcut lookups buildCommands does no longer run on every keystroke, drag
  // and progress tick.
  const getCommands = useStableCallback((): Command[] =>
    buildCommands({
      tr,
      hintFor,
      platform: window.api.platform,
      tracks,
      visibleTracks,
      selected,
      selectedTracksCount: selectedTracks.length,
      settings,
      analysis,
      matching,
      autoMatchable,
      canProcessSelected,
      canProcessAll,
      editorFormatRef,
      editorNormalizeRef,
      trackSearchRef,
      pickFiles: () => void pickFiles(),
      selectAll,
      askFillAll: onFillAll,
      moveSelection,
      jumpSelection,
      pageSelection,
      focusList,
      focusMatches,
      focusEditor,
      togglePlay,
      processOne: convertSelected,
      askConvertAll,
      cancelAnalysis,
      analyzeAllQuality,
      cancelAutoMatch,
      enqueueAutoMatch,
      addTrackToAppleMusic,
      removeTrack,
      reveal: window.api.reveal,
      askClearAll: onClearEverything,
      openSettings,
      openFindReplace: overlays.openFindReplace,
      openExport: overlays.openExport,
      openRename: overlays.openRename,
      openActivity: () => setActivityOpen(true),
      openHelp: overlays.openHelp,
      toggleLanguage: () => void i18n.changeLanguage(nextLocale(i18n.language)),
      toggleTheme,
      clearMeta,
      deriveTags,
      fireConfetti,
    }),
  )

  // Closes the open overlay on Escape. Onboarding is deliberately omitted: it forces a
  // deliberate choice, not an Escape dismissal.
  function closeTopOverlay(): void {
    if (!activeModal || activeModal.type === 'onboarding') return
    if (activeModal.type === 'settings') setThemePreview(null)
    overlays.close()
  }

  // Any open modal/overlay also swallows the global shortcuts, or space/j/k/⌘⏎ would act
  // on the list behind the dialog (e.g. start a conversion behind the confirm prompt).
  const overlayOpen = activeModal !== null

  useKeyboardShortcuts({
    isMac,
    overlayOpen,
    bindings,
    getCommands,
    onTogglePalette: overlays.togglePalette,
    onEscape: closeTopOverlay,
  })

  // Drives the slim top bar: the analyze/auto-match/convert sweeps pool their progress,
  // and a fresh drop still reading its tags shows as an indeterminate run.
  const progress = topBarProgress(
    [analysis, matching, batchProgress, importProgress],
    tracks.some((t) => t.loadingMeta),
  )

  return (
    // Drag-and-drop is a pointer-only convenience; the "Add files" button is the
    // keyboard-accessible path to the same action.
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control
    <div
      className="flex h-screen flex-col"
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      {/* Music preview playback — there is no speech to caption. The clock
          (currentTime/duration/paused) is read by LivePlayer, which subscribes to
          this element directly so playback re-renders only the card. */}
      {/* biome-ignore lint/a11y/useMediaCaption: audio is a music preview, captions don't apply */}
      <audio ref={audioRef} hidden onEnded={onTrackEnded} />
      {/* Names the window for screen readers; visually redundant with the title bar. */}
      <h1 className="sr-only">Surco</h1>
      {/* The Toolbar's own bottom border doubles as the progress track: the bar sits on
          that divider so a long sweep lights up the line between the toolbar and the list. */}
      <div className="relative">
        {progress && <TopProgressBar fraction={progress.fraction} />}
        <Toolbar
          isMac={isMac}
          trackCount={tracks.length}
          importing={importProgress}
          batchSummary={batchSummary}
          batching={batching}
          analysis={analysis}
          allAnalyzed={allAnalyzed}
          matching={matching}
          hasToken={!!settings?.discogsToken}
          autoMatchable={autoMatchable}
          onAnalyzeAll={onAnalyzeAll}
          onCancelAnalyze={cancelAnalysis}
          onAutoMatch={onAutoMatchAll}
          onCancelAutoMatch={cancelAutoMatch}
          onExport={onOpenExport}
          onPalette={onOpenPalette}
          onStats={onOpenStats}
          onActivity={() => setActivityOpen((v) => !v)}
          activityRunning={activityRows.some((r) => r.status === 'running')}
          onSettings={onOpenSettings}
        />
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          style={{ width: sidebar.width }}
          className="relative shrink-0 bg-[var(--color-panel)]"
        >
          <div
            ref={listScrollRef}
            className={`h-full overflow-y-auto ${playerVisible && playerTrack ? 'pb-32' : ''}`}
          >
            {tracks.length === 0 ? (
              // Empty list: the drop hint plus the Add files button, so the action that fills
              // this column is reachable here even before there's a header to host it.
              <div className="flex flex-col items-center gap-3 p-6 text-center">
                <p className="text-xs text-fg-faint">{tr('sidebar.dropHint')}</p>
                <button
                  type="button"
                  data-testid="add-files"
                  onClick={onAdd}
                  className="press flex h-8 items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
                >
                  {tr('header.add')}
                </button>
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-panel)]">
                  <div className="flex items-center gap-1.5 px-1.5 pt-2">
                    <SearchInput
                      className="flex-1"
                      testid="track-search"
                      inputRef={trackSearchRef}
                      value={search}
                      onChange={setSearch}
                      onClear={() => setSearch('')}
                      onKeyDown={(e) => {
                        // Escape clears a running filter, then a second press (or one on an
                        // empty field) drops focus back to the list — a quick way out of a search.
                        if (e.key !== 'Escape') return
                        if (search) {
                          e.stopPropagation()
                          setSearch('')
                        } else {
                          e.currentTarget.blur()
                        }
                      }}
                      ariaLabel={tr('sidebar.search.placeholder')}
                      placeholder={tr('sidebar.search.placeholder')}
                      clearLabel={tr('sidebar.search.clear')}
                    />
                  </div>
                  <QualityFilterBar
                    filterRef={qualityFilterRef}
                    value={filterSelection}
                    onChange={setFilterSelection}
                    tally={qualityTally}
                    formats={formatTally}
                    trackCount={tracks.length}
                    visibleCount={visibleTracks.length}
                    selectedPosition={selectedPosition}
                    onRevealSelected={scrollToSelected}
                  >
                    <Select
                      testid="track-sort"
                      value={sortBy}
                      onChange={(v) => setSortBy(v as TrackSort)}
                      label={tr('sidebar.sort.label')}
                      options={[
                        { value: 'import', label: tr('sidebar.sort.import'), icon: ArrowDownUp },
                        { value: 'name', label: tr('sidebar.sort.name'), icon: CaseSensitive },
                        { value: 'artist', label: tr('sidebar.sort.artist'), icon: User },
                        { value: 'duration', label: tr('sidebar.sort.duration'), icon: Clock },
                        { value: 'format', label: tr('sidebar.sort.format'), icon: FileAudio },
                      ]}
                    />
                    {sortBy !== 'import' && (
                      <button
                        type="button"
                        data-testid="track-sort-direction"
                        aria-pressed={sortDir === 'desc'}
                        aria-label={tr(
                          sortDir === 'asc' ? 'sidebar.sort.ascending' : 'sidebar.sort.descending',
                        )}
                        onClick={toggleSortDir}
                        className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--color-line)] bg-[var(--color-field)] text-fg-dim outline-none hover:text-fg focus:border-[var(--color-accent)]"
                      >
                        {sortDir === 'asc' ? (
                          <ArrowDownNarrowWide className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <ArrowUpNarrowWide className="h-4 w-4" aria-hidden="true" />
                        )}
                        <Tooltip
                          label={tr(
                            sortDir === 'asc'
                              ? 'sidebar.sort.ascending'
                              : 'sidebar.sort.descending',
                          )}
                        />
                      </button>
                    )}
                  </QualityFilterBar>
                  {/* List actions get their own row under the filter/sort, not squeezed into
                      it — crammed beside the filter they pushed the "All" quality dropdown out
                      of sight. They operate on these rows, so they live in the list header (not
                      the global toolbar where it wasn't clear which column they touched). */}
                  <div className="flex items-center gap-0.5 px-1.5 pb-2">
                    {/* Add files leads the list's own action row: it's what fills this column,
                        so it belongs with the list rather than the global toolbar. */}
                    <button
                      type="button"
                      data-testid="add-files"
                      onClick={onAdd}
                      aria-label={tr('header.add')}
                      className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
                    >
                      <FilePlus className="h-4 w-4" aria-hidden="true" />
                      <Tooltip label={tr('header.add')} />
                    </button>
                    {tracks.length > 0 && (
                      <>
                        <span
                          aria-hidden="true"
                          className="mx-0.5 h-5 w-px shrink-0 self-center bg-[var(--color-line)]"
                        />
                        <button
                          type="button"
                          data-testid="select-all"
                          onClick={onSelectAllTracks}
                          aria-label={tr('header.selectAll')}
                          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
                        >
                          <SquareCheckBig className="h-4 w-4" aria-hidden="true" />
                          <Tooltip label={tr('header.selectAll')} />
                        </button>
                        {selectedId && (
                          <button
                            type="button"
                            data-testid="reveal-selected"
                            onClick={scrollToSelected}
                            aria-label={tr('header.revealSelected')}
                            className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
                          >
                            <Crosshair className="h-4 w-4" aria-hidden="true" />
                            <Tooltip label={tr('header.revealSelected')} />
                          </button>
                        )}
                        <button
                          type="button"
                          data-testid="fill-all"
                          onClick={onFillAll}
                          aria-label={tr('header.fillFromName')}
                          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
                        >
                          <Tag className="h-4 w-4" aria-hidden="true" />
                          <Tooltip label={tr('header.fillFromName')} />
                        </button>
                        <button
                          type="button"
                          data-testid="open-find-replace"
                          onClick={onFindReplace}
                          aria-label={tr('commands.findReplace')}
                          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-fg"
                        >
                          <Replace className="h-4 w-4" aria-hidden="true" />
                          <Tooltip label={tr('commands.findReplace')} />
                        </button>
                        {/* Clear is destructive, so it sits apart at the far end. */}
                        <span className="flex-1" />
                        <button
                          type="button"
                          data-testid="clear-all"
                          onClick={onClearAll}
                          aria-label={tr('header.clearAll')}
                          className="press relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none transition-colors hover:bg-[var(--color-panel-2)] hover:text-danger"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          <Tooltip label={tr('header.clearAll')} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {visibleTracks.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 p-6 text-center">
                    <p className="text-xs text-fg-faint">{tr('sidebar.search.empty')}</p>
                    {(search || filterActive) && (
                      <button
                        type="button"
                        data-testid="reset-view"
                        onClick={() => {
                          setSearch('')
                          setFilterSelection(EMPTY_FILTER)
                        }}
                        className="press rounded-md border border-[var(--color-line)] bg-[var(--color-field)] px-2.5 py-1 text-xs text-fg-dim outline-none hover:text-fg focus:border-[var(--color-accent)]"
                      >
                        {tr('sidebar.search.reset')}
                      </button>
                    )}
                  </div>
                ) : (
                  <TrackList
                    tracks={visibleTracks}
                    selectedId={selectedId}
                    selectedIds={selectedIdSet}
                    outputFormat={settings?.outputFormat ?? 'aiff'}
                    onSelect={onSelectTrack}
                    onActivate={toggleTrack}
                    onRemove={removeFromList}
                    onPrefetch={handlePrefetch}
                    onSearch={onSearchTrack}
                    onStartOver={startOverTrack}
                    onCopyMeta={onCopyMeta}
                    onPasteMeta={onPasteMeta}
                    canPasteMeta={copiedMeta !== null}
                    onTrash={(track) => askTrash(menuTargets(track.id))}
                    scrollRootRef={listScrollRef}
                    onVisible={onTrackVisible}
                    rowRegistry={rowEls}
                  />
                )}
              </>
            )}
          </div>
          {playerVisible && playerTrack && (
            <LivePlayer
              track={playerTrack}
              audioRef={audioRef}
              continuous={settings?.continuousPlayback ?? false}
              onToggleContinuous={() =>
                saveSettings({ continuousPlayback: !(settings?.continuousPlayback ?? false) })
              }
              showWaveform={settings?.showWaveform ?? true}
              onToggleWaveform={() =>
                saveSettings({ showWaveform: !(settings?.showWaveform ?? true) })
              }
              onClose={closePlayer}
            />
          )}
        </aside>

        <ResizeHandle
          onPointerDown={sidebar.onPointerDown}
          onDoubleClick={autoFitSidebar}
          title={tr('sidebar.fitHint')}
        />

        <main className="min-w-0 flex-1 bg-[var(--color-panel)]">
          {selected ? (
            // Its own boundary so a render bug in the editor degrades to "this panel
            // crashed" — the imported crate and the list stay alive. Keyed by track,
            // which both remounts the editor per track (its state-seeding contract)
            // and clears a tripped fallback on the next track switch.
            <ErrorBoundary
              key={selected.id}
              className="flex h-full flex-col gap-4 overflow-auto p-8 text-sm"
            >
              <Editor
                item={selected}
                libraryIndex={libraryIndex}
                hasToken={!!settings?.discogsToken}
                outputFormat={settings?.outputFormat ?? 'aiff'}
                addToAppleMusic={settings?.addToAppleMusic ?? false}
                overwriteOriginal={settings?.overwriteOriginal ?? false}
                replaceLowResCover={settings?.replaceLowResCover ?? false}
                autoApplyFilename={settings?.autoApplyFilename ?? false}
                filenameFormat={settings?.filenameFormat ?? '{artist} - {title}'}
                groupingPresets={settings?.groupingPresets ?? []}
                genrePresets={settings?.genrePresets ?? []}
                visibleFields={settings?.visibleFields ?? DEFAULT_FIELDS}
                requiredFields={settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS}
                discogsFormats={settings?.discogsFormats ?? EMPTY_FORMATS}
                discogsMaxResults={settings?.discogsMaxResults ?? DEFAULT_DISCOGS_MAX_RESULTS}
                searchProviders={settings?.searchProviders ?? DEFAULT_SEARCH_PROVIDERS}
                showSpectrum={settings?.showSpectrum ?? true}
                showLoudness={settings?.showLoudness ?? true}
                keyNotation={settings?.keyNotation ?? 'camelot'}
                normalize={settings?.normalize ?? DEFAULT_NORMALIZE}
                searchInputRef={searchInputRef}
                selectedTracks={selectedTracks}
                onApplyMatches={onApplyMatches}
                onProcessAll={onProcessAllSelected}
                onAddAllToAppleMusic={onAddAllSelectedToAppleMusic}
                onChangeAllMeta={onChangeAllMeta}
                onApplyCoverAll={onApplyCoverAll}
                onDeriveTags={deriveTracks}
                onChange={onEditorChange}
                onProcess={onProcessSelected}
                onFormatChange={onFormatChange}
                onNormalizeChange={onNormalizeChange}
                onAddToAppleMusic={onAddSelectedToAppleMusic}
                onTrashOriginal={onTrashOriginal}
                onOpenSettings={onOpenSettings}
                onShowLoudnessHelp={onShowLoudnessHelp}
                onOpenRename={onOpenRename}
                onRegenerateName={onRegenerateName}
                onCopyFilename={onCopyFilename}
              />
            </ErrorBoundary>
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center">
              <div className="max-w-sm">
                <AudioLines
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className="mx-auto mb-5 h-12 w-12 text-fg-faint"
                />
                <p className="text-[15px] font-medium text-balance text-fg-muted">
                  {tr('empty.title')}
                </p>
                <p className="mt-1.5 text-sm text-pretty text-fg-dim">
                  {tr(
                    window.api.platform === 'darwin' ? 'empty.subtitle' : 'empty.subtitleNoMusic',
                  )}
                </p>
              </div>
            </div>
          )}
        </main>
      </div>

      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--color-accent)]/10 ring-2 ring-inset ring-[var(--color-accent)]">
          <span className="rounded-xl bg-[var(--color-panel)] px-6 py-3 text-lg font-medium">
            {tr('drop.release')}
          </span>
        </div>
      )}

      {/* The lazy overlays load their chunk on first open; fallback={null} because an
          overlay arriving a frame late is invisible (it fades in anyway). */}
      <Suspense fallback={null}>
        {activeModal?.type === 'settings' && settings && (
          <SettingsModal
            settings={settings}
            onClose={closeSettings}
            onSave={saveSettings}
            onPreviewTheme={setThemePreview}
            onSettingsReplaced={setSettings}
            initialTab={activeModal.tab}
          />
        )}

        {activeModal?.type === 'onboarding' && settings && (
          <OnboardingWizard settings={settings} onFinish={finishOnboarding} />
        )}

        {activeModal?.type === 'donateNudge' && (
          <DonateNudgeModal
            conversionCount={settings?.conversionCount ?? 0}
            onClose={(dismissForever) => {
              if (dismissForever) saveSettings({ donateNudgeDismissed: true })
              overlays.close()
            }}
          />
        )}

        {activeModal?.type === 'help' && <HelpModal onClose={overlays.close} />}
        {activeModal?.type === 'loudnessHelp' && <LoudnessHelpModal onClose={overlays.close} />}
        {activeModal?.type === 'findReplace' && (
          <FindReplaceModal
            tracks={findReplaceTargets}
            onApply={deriveTracks}
            onClose={overlays.close}
          />
        )}
        {activeModal?.type === 'rename' && selected && (
          <RenameModal
            meta={selected.meta}
            initialFormat={settings?.filenameFormat ?? '{artist} - {title}'}
            extension={editorFormatRef.current ?? settings?.outputFormat ?? 'aiff'}
            onApply={(outputName) => updateTrack(selected.id, { outputName })}
            onClose={overlays.close}
          />
        )}
        {activeModal?.type === 'export' && <ExportModal tracks={tracks} onClose={overlays.close} />}
        {activeModal?.type === 'confirm' && (
          <ConfirmDialog
            title={activeModal.confirm.title}
            message={activeModal.confirm.message}
            confirmLabel={activeModal.confirm.confirmLabel}
            confirmDisabled={activeModal.confirm.confirmDisabled}
            destructive={activeModal.confirm.destructive}
            onConfirm={activeModal.confirm.onConfirm}
            onClose={overlays.close}
          />
        )}

        {activeModal?.type === 'palette' && (
          <CommandPalette
            commands={getCommands()}
            // Searching by title/artist turns ⌘K into a jump-to-track launcher over the
            // visible list; picking a track selects and scrolls to it, then the palette
            // closes itself (runAt → onClose) like any other command.
            tracks={visibleTracks}
            onGoToTrack={revealSelection}
            usage={settings?.commandUsage ?? {}}
            // Learn from each run so the next filtered list floats the user's habits up.
            onRunCommand={(id) =>
              saveSettings({
                commandUsage: {
                  ...(settings?.commandUsage ?? {}),
                  [id]: (settings?.commandUsage?.[id] ?? 0) + 1,
                },
              })
            }
            // A command's run() may itself open another modal (settings, find & replace,
            // export…). Closing the palette must not clobber that: only dismiss it when the
            // palette is still the active modal, so a command that navigated elsewhere wins.
            onClose={overlays.closeIfPalette}
          />
        )}
      </Suspense>

      <ToastStack toasts={toasts} onExpire={expireToast} onClose={closeToast} />
      {activityOpen && (
        <ActivityPanel
          rows={activityRows}
          onClear={clearActivity}
          onClose={() => setActivityOpen(false)}
        />
      )}
      {confettiBurst > 0 && <Confetti key={confettiBurst} />}
    </div>
  )
}
