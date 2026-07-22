import { useQueryClient } from '@tanstack/react-query'
import { AudioLines } from 'lucide-react'
import type React from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { autoMatchAvailable } from '../../shared/autoMatch'
import { emptyMetadata } from '../../shared/metadata'
import { resolveBindings } from '../../shared/shortcutDefaults'
import type {
  DeclickMode,
  FormatSetting,
  NormalizeConfig,
  OutputFormat,
  SearchProviderId,
  ThemePref,
  TrackMetadata,
} from '../../shared/types'
import { ActivityPanel } from './components/ActivityPanel'
import { Confetti } from './components/Confetti'
import { Editor } from './components/Editor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Overlays } from './components/Overlays'
import { LivePlayer } from './components/Player'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { ToastStack } from './components/ToastStack'
import { Toolbar } from './components/Toolbar'
import { TopProgressBar } from './components/TopProgressBar'
import { TrackContextMenu } from './components/TrackContextMenu'
import { type MenuState as TrackMenuState, TrackList } from './components/TrackList'
import { TrackListHeader } from './components/TrackListHeader'
import { useActivityLog } from './hooks/useActivityLog'
import { useAutoMatch } from './hooks/useAutoMatch'
import { useConfirmFlows } from './hooks/useConfirmFlows'
import { useDockPlayingIndicator } from './hooks/useDockPlayingIndicator'
import { useEditorPicks } from './hooks/useEditorPicks'
import { editorSectionOpen, useMaximizedSection } from './hooks/useEditorSections'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useLaunchModals } from './hooks/useLaunchModals'
import { useListNavigation } from './hooks/useListNavigation'
import { useMetadataClipboard } from './hooks/useMetadataClipboard'
import { useMetaUndo } from './hooks/useMetaUndo'
import { useTriageFilters } from './hooks/useTriageFilters'
import { type SettingsTab, useOverlays } from './hooks/useOverlays'
import { usePlayer } from './hooks/usePlayer'
import { useQualityAnalysis } from './hooks/useQualityAnalysis'
import { useSessionPersistence } from './hooks/useSessionPersistence'
import { useSettings } from './hooks/useSettings'
import { spectrogramOptions } from './hooks/useSpectrogram'
import { useStableCallback } from './hooks/useStableCallback'
import { NEW_TRACKS_PROMPT_TIMEOUT_MS, useTrackLibrary } from './hooks/useTrackLibrary'
import { useTrackProcessing } from './hooks/useTrackProcessing'
import { useTracksView, type ViewCacheEntry } from './hooks/useTracksView'
import { waveformOptions } from './hooks/useWaveform'
import { nextLocale } from './i18n/locale'
import { removeAnalysisQueries } from './lib/analysisQueries'
import type { AppleMusicIndex, StaleLibraryCopy } from './lib/appleMusicLibrary'
import { type AppError, type AppStore, createAppStore, useAppStore } from './lib/appStore'
import { acceptReviewPatch, type MatchCleanup, tracksToAutoMatch } from './lib/autoMatch'
import { canProcessTrack, eligibleForBatch } from './lib/batch'
import { buildCommands, type Command, runCommand } from './lib/commands'
import { revokeCoverUrl, revokeCoverUrlIfUnused, revokeDisplacedCovers } from './lib/coverUrl'
import { deriveTagPatches } from './lib/deriveTags'
import type { Destination } from './lib/destination'
import { DEFAULT_REQUIRED_FIELDS } from './lib/fields'
import {
  activeFocusPreset,
  DEFAULT_RESULTS_WIDTH,
  type FocusPresetId,
  focusPresetWidth,
} from './lib/focusPreset'
import { isTypingTarget } from './lib/keymap'
import { librarySourceOf } from './lib/librarySource'
import { outputNamePatches, renderOutputName, titleFormatSummary } from './lib/outputName'
import { clampPanelGeometry } from './lib/panelGeometry'
import { isMacOS } from './lib/platform'
import { needsDiscogsPrefetch } from './lib/prefetch'
import { applyProgress, topBarProgress } from './lib/progress'
import type { ReleaseMetaPatch } from './lib/release'
import { contentDeficit } from './lib/resize'
import {
  type ClickMods,
  clickSelect,
  editScope,
  reanchorToVisible,
  type Selection,
} from './lib/selection'
import { OpenSettingsProvider } from './lib/openSettingsContext'
import { SettingsProvider } from './lib/settingsContext'
import { formatShortcut } from './lib/shortcuts'
import { matchStatKey } from './lib/stats'
import { ToastProvider, type ToastReporter } from './lib/toastContext'
import { dismissToast, dismissToastByExpiry, dismissToastByUser, pushToast } from './lib/toastQueue'
import {
  EMPTY_FILTER,
  filterWithSticky,
  formatBuckets,
  matchesSearch,
  qualityCounts,
  sortTracks,
  suspectTracks,
  type TrackSort,
} from './lib/triage'
import { detectTrim } from './lib/trim'
import type { CopiedTags, TrackItem } from './types'

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
const _DEFAULT_NORMALIZE: NormalizeConfig = {
  mode: 'none',
  targetLufs: -14,
  truePeakDb: -1,
  peakDb: -1,
}

// macOS shows ⌘; everywhere else the shortcuts fire on Ctrl and read as "Ctrl".
const isMac = window.api.platform === 'darwin'

// Stable empty default for the Discogs format filter, so a settings-less first frame
// doesn't hand the memoized Editor a fresh [] each render.
const _EMPTY_FORMATS: string[] = []

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
  const expireToast = useCallback((id: string) => dismissToastByExpiry(store, id), [store])
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
  // The route out for a failure raised deep in the tree — the quality report, the stats
  // image, a dragged cover — none of which can reach the store from where they live. Same
  // red persistent card as setAppError, but taking a ready message: those callers know
  // exactly what failed, so they translate it themselves rather than squeezing it through
  // the AppError kinds. Memoized: an unstable value here would re-render every consumer.
  const toastReporter = useMemo<ToastReporter>(
    () => ({
      reportError: (message: string) =>
        void pushToast(store, { key: 'app-error', tone: 'danger', message, testid: 'app-error' }),
    }),
    [store],
  )
  // The activity log: always-accumulating feed of background work, shown in a
  // movable floating panel the user toggles.
  const { rows: activityRows, clear: clearActivity, report: reportActivity } = useActivityLog()
  const [activityOpen, setActivityOpen] = useState(false)
  // Persisted settings (initial load, modal-open refresh, theme application,
  // optimistic save) live in the hook; App only decides the launch modal.
  const settingsOpen = activeModal?.type === 'settings'
  const { settings, setSettings, saveSettings, setThemePreview } = useSettings({
    settingsOpen,
    // Fired async after the first read lands, so closing over the hook defined right
    // below is safe — the launch decision itself lives in useLaunchModals.
    onFirstLoad: (s) => decideOnLoad(s),
    onLoadError: () => setAppError({ kind: 'settingsLoad' }),
    onSaveError: () => setAppError({ kind: 'settingsSave' }),
  })
  const { decideOnLoad, maybeShowDonateNudge, finishOnboarding } = useLaunchModals({
    overlays,
    saveSettings,
    setSettings,
  })
  // Quality triage filter, free-text search and display order — read from the store with a
  // stable setter each (field comments live in appStore).
  const { filterSelection, filterActive, formatFilter, setFilterSelection, setFormatFilter } =
    useTriageFilters(store)
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
    (m: CopiedTags | null) => store.setState({ copiedMeta: m }),
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
  // Live title-cleanup settings for the sweep's scorer (the Naming pattern and the
  // user's junk phrases), read at probe time like the providers above.
  const matchCleanupRef = useRef<MatchCleanup>({})
  matchCleanupRef.current = {
    titleFormat: settings?.titleFormat,
    ignoreWords: settings?.searchIgnoreWords,
  }
  // Live view of the Apple Music library snapshot for the sweep, kept current below once
  // useTracksView has computed it (the sweep reads it at apply time, not at render).
  const libraryIndexRef = useRef<AppleMusicIndex | null>(null)
  // The track whose editor field currently holds focus, set by the Editor on focus/blur.
  // The sweep reads it so a match can't overwrite a row while the user is typing into it —
  // the field's buffered edit isn't in the live meta yet, so the meta guard alone can't
  // see it (see useAutoMatch's editingRef).
  const editingRef = useRef<string | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()
  // The latest spectrum-merged view of the tracks, so the hover-prefetch and analyze
  // callbacks (which read refs to stay stable) can see each track's cached spectrum
  // without re-subscribing.
  const tracksViewRef = useRef<TrackItem[]>([])
  // The current visible (filtered/sorted/searched) order, so the stable select callback
  // resolves a Shift range over what's on screen rather than the full import order.
  const visibleTracksRef = useRef<TrackItem[]>([])
  // Ref twin of the bulk-action scope (declared early: the analysis sweep reads it
  // before the memo below exists); assigned right after bulkTracks is computed.
  const bulkTracksRef = useRef<TrackItem[]>([])
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
  const {
    formatRef: editorFormatRef,
    destinationRef: editorDestinationRef,
    normalizeRef: editorNormalizeRef,
    declickRef: editorDeclickRef,
    onFormatChange,
    onDestinationChange,
    onNormalizeChange,
    onDeclickChange,
    reset: resetEditorPicks,
  } = useEditorPicks(settings, saveSettings)

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
    clearExtrasTracks,
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
    onRemove: (removed) => {
      const gone = new Set(removed.map((t) => t.id))
      for (const track of removed) {
        discogsPrefetched.current.delete(track.id)
        viewCache.current.delete(track.id)
        forgetAutoMatch(track.id)
        removeAnalysisQueries(queryClient, track.inputPath)
      }
      // A picked cover's blob URL would otherwise pin the image file until quit — but a
      // cover applied across a selection is shared, so keep it while another row uses it.
      // Weighed against the survivors of the whole batch: judging each row against a list
      // that still holds its doomed siblings would keep a selection-wide cover alive after
      // the entire selection is gone.
      revokeDisplacedCovers(
        removed.map((t) => t.coverUrl),
        tracksRef.current.filter((t) => !gone.has(t.id)).map((t) => t.coverUrl),
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
      // Auto-analyze runs the full background sweep so a reopened crate has every heavy
      // analysis already on disk — the sweep reads bulkTracksRef (the visible rows) and
      // skips any already measured, so this stays a cheap re-trigger per import. Passing t
      // explicitly covers the track this call is for even before bulkTracksRef's render has
      // caught up with it (see analyzeAllQuality). Ignores the quality-section fold: this is
      // an explicit "always analyze my imports" setting.
      if (settings?.autoAnalyze) analyzeAllQuality([t])
    },
    onDuplicatesSkipped: (count) => setNotice(tr('notices.duplicatesSkipped', { count })),
    onMetaReadFailed: (count) => setNotice(tr('notices.metaReadFailed', { count })),
  })

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [setTracks],
  )

  // The last session: offered back at launch, written out as it changes. Self-contained —
  // it hands nothing back.
  useSessionPersistence({ tracks, tracksRef, addPaths, store, tr })

  // The watcher's "N new tracks" prompt rides the same queue as every other toast: keyed so a
  // second copy-in updates the count in place, and with a Load action that adds the tracks.
  // Re-pushed whenever the pending set changes; dismissed when it clears (the user accepted,
  // the hook's timeout declined it, or the crate was emptied). The duration only draws the
  // countdown bar — the expiry that counts is the hook's, which remembers the declined files.
  useEffect(() => {
    if (!pendingNew) return
    // Both separators — the watcher root is a raw OS path, backslashed on Windows.
    const folder = pendingNew.root.split(/[/\\]/).pop() || pendingNew.root
    const id = pushToast(store, {
      key: 'new-tracks',
      tone: 'neutral',
      testid: 'new-tracks',
      message: tr('newTracks.prompt', { count: pendingNew.paths.length, folder }),
      action: { label: tr('newTracks.load'), onAction: loadPending },
      onDismiss: dismissPending,
      duration: NEW_TRACKS_PROMPT_TIMEOUT_MS,
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
    // The bulk scope: a deliberate multi-selection when there is one, else the visible
    // (filtered) rows. Already-measured tracks are skipped, so widening the scope never
    // re-analyses what a narrower one already did.
    targetsRef: bulkTracksRef,
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
  } = useAutoMatch({
    tracksRef,
    updateTrack,
    libraryIndexRef,
    searchProvidersRef,
    matchCleanupRef,
    editingRef,
    reportActivity,
  })

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
  // useStableCallback (not useCallback) on purpose: this depends on tracks/selectedIds,
  // which change on every keystroke and every progress tick, so a plain useCallback
  // gives removeFromList a fresh identity that often — breaking TrackRow's memo (it
  // relies on a stable onRemove) and re-rendering every row on every edit.
  const menuTargets = useStableCallback((id: string): TrackItem[] =>
    selectedIds.includes(id) && selectedIds.length > 1
      ? tracks.filter((t) => selectedIds.includes(t.id))
      : tracks.filter((t) => t.id === id),
  )

  const removeFromList = useStableCallback((id: string): void => {
    askRemoveFromList(menuTargets(id))
  })

  const onTrashRow = useStableCallback((track: TrackItem): void => {
    askTrash(menuTargets(track.id))
  })

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
    cancelBatch,
    cancelOne,
  } = useTrackProcessing({
    tracks,
    settings,
    updateTrack,
    onConversion: maybeShowDonateNudge,
    onNormalizeSkipped: (name) => setNotice(tr('notices.normalizeSkipped', { name })),
    // Only when the repair actually touched samples: a clean track reporting "0
    // clicks" on every convert would train the user to ignore the notice.
    onDeclicked: (name, count) => setNotice(tr('notices.declicked', { name, count })),
    // A batch run shows this skip through batchSummary's "N skipped" count, but a
    // single-track convert (the editor button, ⌘⏎) has no summary to show it in.
    onFormatSkipped: (name) => setNotice(tr('notices.formatSkipped', { name })),
    // Keyed so a bulk run failing on every track (e.g. Engine DJ open) raises one
    // card, not thirty; persistent like every failure toast.
    onProcessError: (message) =>
      pushToast(store, { key: 'process-error', tone: 'danger', message, testid: 'process-error' }),
  })

  // Emptying every row starts over — clearTracks also drops the folder watcher. Emptying just
  // the filtered-visible subset removes those rows and keeps watching, so the hidden FLAC/WAV
  // tracks survive the click.
  const emptyTracks = useStableCallback((targets: TrackItem[]) => {
    if (targets.length === tracksRef.current.length) clearTracks()
    else removeTracks(targets.map((t) => t.id))
  })

  const metaUndo = useMetaUndo(tracksRef, setTracks)
  // Snapshots the given rows' tags so ⌘Z can roll the batch operation back. Reads
  // through tracksRef so the stable callbacks capturing it never see a stale list.
  const recordMetaUndo = useStableCallback((ids: string[], opts?: { cover?: boolean }) => {
    const set = new Set(ids)
    metaUndo.record(
      tracksRef.current.filter((t) => set.has(t.id)),
      opts,
    )
  })
  // Every deriveTracks consumer is a discrete batch overwrite (fill-all, find & replace,
  // the Tag buttons), so recording the undo snapshot at this seam covers them all —
  // unlike updateTracksMeta, whose per-field bulk edits fire on every keystroke.
  const deriveTracksUndoable = useStableCallback(
    (patches: { id: string; meta: Partial<TrackMetadata> }[]) => {
      recordMetaUndo(patches.map((p) => p.id))
      deriveTracks(patches)
    },
  )

  // The confirm-before-firing actions (trash, delete original, fill-all, clear-all,
  // in-place convert-all): each builds its dialog and wires onConfirm into the data layer.
  const {
    askTrash,
    askDeleteOriginal,
    askRemoveOldMusicCopy,
    askFillAll,
    askClearAll,
    askRemoveFromList,
    askConvertAll,
    askConvertOne,
  } = useConfirmFlows({
    settings,
    removeTrack,
    updateTrack,
    emptyTracks,
    deriveTracks: deriveTracksUndoable,
    processAll,
    openConfirm: overlays.openConfirm,
    reportTrashFailure: (fileName) => setAppError({ kind: 'trash', detail: fileName }),
    // The old entry left the snapshot's library, so refresh it — that recompute is
    // also what retires the footer's "remove the old copy" link. The toast confirms
    // the outcome meanwhile, since the refetch can take a moment on a big library.
    onOldMusicCopyRemoved: () => {
      void queryClient.invalidateQueries({ queryKey: ['library-membership'] })
      pushToast(store, {
        tone: 'neutral',
        message: tr('editor.oldCopyRemoved'),
        duration: 4000,
        testid: 'old-copy-removed',
      })
    },
    // A mismatch means the script refused to delete: the live Music track no longer
    // matched the confirmed label, so the snapshot that named it is stale/misaligned —
    // refresh it so the footer link recomputes from reality.
    reportOldCopyRemoveFailure: (mismatch) => {
      if (mismatch) void queryClient.invalidateQueries({ queryKey: ['library-membership'] })
      pushToast(store, {
        key: 'old-copy-error',
        tone: 'danger',
        message: tr(mismatch ? 'editor.removeOldCopyMismatch' : 'editor.removeOldCopyError'),
        testid: 'old-copy-error',
      })
    },
    tracksRef,
  })

  const openSettings = (tab: SettingsTab = 'general'): void => overlays.openSettings(tab)

  function closeSettings(): void {
    overlays.close()
    setThemePreview(null)
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

  // Memoized so the O(n) lookup runs only when the list or the selection changes, not on
  // every App render (a progress tick, a drag-over, a hover prefetch) — on a large crate
  // that scan was paid on each of those frequent renders.
  const selected = useMemo(
    () => tracks.find((t) => t.id === selectedId) ?? null,
    [tracks, selectedId],
  )
  // With nothing selected there is no editor reporting picks; the convert-all
  // shortcut then falls back to the Settings defaults.
  if (!selected) resetEditorPicks()
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
  const { audioRef, playerVisible, playerTrack, togglePlay, seek, toggleTrack, closePlayer } =
    usePlayer({
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

  // Which library the membership check reads — the conversion destination's (Apple
  // Music or the Engine DJ database), or none for folder/overwrite conversions.
  const librarySource = useMemo(() => librarySourceOf(settings, isMacOS()), [settings])
  // Merges each track's cached spectrum and library verdict onto it (identity-stable
  // via viewCache), driving the quality triage, the list and the editor's library badge.
  const { tracksView, libraryIndex } = useTracksView(tracks, viewCache, librarySource)
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
    const { quality, conversion, library, duplicates, format } = filterSelection
    const key = `${quality ?? ''}|${conversion ?? ''}|${library ?? ''}|${duplicates ?? ''}|${format ?? ''}`
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
  // (filtered) rows — never the tracks the active filter is hiding. Reactive because the
  // open Find & Replace modal re-previews live as the set changes; the ref twin below
  // feeds the sweeps and stable callbacks that read at call time.
  const bulkTracks = useMemo(
    () => (selectedTracks.length > 1 ? selectedTracks : visibleTracks),
    [selectedTracks, visibleTracks],
  )
  bulkTracksRef.current = bulkTracks
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
  // Auto-match is on but the provider can't run (no Discogs token): the sweep silently does
  // nothing, so the toolbar button turns into a live "add a token" fix instead of a greyed
  // dead end. Only with tracks loaded — nothing to match on an empty list.
  const needsToken = tracks.length > 0 && !!settings?.autoMatch && !autoMatchAvailable(settings)
  const canProcessAll = eligibleCount > 0 && !batching

  // Effective key bindings (defaults + the user's overrides): the single source the
  // palette hints below and the keydown listener (via a ref, since it subscribes once)
  // both read, so a rebind in Settings updates everywhere at once.
  const bindings = useMemo(
    () => resolveBindings(settings?.shortcutOverrides),
    [settings?.shortcutOverrides],
  )
  const hintFor = useCallback(
    (id: string): string => formatShortcut(bindings.get(id) ?? [], isMac),
    [bindings],
  )

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
  const onFillAll = useStableCallback(() =>
    askFillAll(bulkTracksRef.current, { fromSelection: selectedTracks.length > 1 }),
  )
  const onFindReplace = useStableCallback(overlays.openFindReplace)
  const onAnalyzeAll = useStableCallback(() => analyzeAllQuality())
  const onAutoMatchAll = useStableCallback(() => enqueueAutoMatch(bulkTracks, false))
  const onOpenExport = useStableCallback(overlays.openExport)
  const onClearAll = useStableCallback(() => askClearAll(visibleTracksRef.current))
  // The one-click "trash the fakes": collect the flagged rips out of the visible rows and route
  // them through the same confirmed trash flow as the right-click menu, so a filter narrows what
  // it deletes and a failure per file is still surfaced.
  const onTrashSuspects = useStableCallback(() => askTrash(suspectTracks(visibleTracksRef.current)))
  // The toolbar/palette "Move the selection to Trash": the same confirmed flow as the
  // context menu, over the multi-selection or the single selected row.
  const onTrashSelected = useStableCallback(() => askTrash(editScope(selectedTracks, selected)))
  // The palette's "Clear the list" is the deliberate start-over: it wipes every track,
  // including the ones an active format filter is hiding, unlike the toolbar trash button.
  const onClearEverything = useStableCallback(() => askClearAll(tracksRef.current))
  const onOpenPalette = useStableCallback(overlays.openPalette)
  const onOpenStats = useStableCallback(() => openSettings('stats'))
  const onOpenSettings = useStableCallback(openSettings)
  // The toolbar's "add a token" fix (shown when auto-match is on but no token is set) opens
  // Settings straight to Search, where the Discogs token lives.
  const onFixToken = useStableCallback(() => openSettings('search'))
  // Toolbar is memoized so a keystroke in a metadata field doesn't re-render it;
  // an inline arrow here would give onActivity a fresh identity every render and
  // defeat that memo just like the other Toolbar handlers above.
  const onToggleActivity = useStableCallback(() => setActivityOpen((v) => !v))
  const onApplyMatches = useStableCallback(
    (patches: { id: string; patch: ReleaseMetaPatch }[], provider: SearchProviderId) => {
      for (const p of patches)
        updateTrack(p.id, { ...p.patch, matched: true, matchProvider: provider })
    },
  )
  const onProcessAllSelected = useStableCallback((format: FormatSetting) =>
    askConvertAll(
      selectedTracks,
      format,
      editorNormalizeRef.current ?? undefined,
      editorDestinationRef.current ?? undefined,
      editorDeclickRef.current ?? undefined,
    ),
  )
  const onAddAllSelectedToAppleMusic = useStableCallback(() => void addAllToAppleMusic(selectedIds))
  const onChangeAllMeta = useStableCallback((patch: Partial<TrackMetadata>) =>
    updateTracksMeta(selectedIds, patch),
  )
  // The multi-select "clear everything" flag pass: mark each cleared track so a
  // convert wipes its cover and rating, not just the text fields — and its own
  // foreign tags, which differ per track so a flat patchTracks patch can't carry them.
  const onClearExtras = useStableCallback((ids: string[]) => clearExtrasTracks(ids))
  const { onCopyMeta, onPasteMeta, onCopyPath, onApplyCoverAll, onCopyFilename } =
    useMetadataClipboard({
      copiedMeta,
      setCopiedMeta,
      tracksRef,
      selectedIds,
      selected,
      filenameFormat: settings?.filenameFormat ?? '{artist} - {title}',
      recordMetaUndo,
      updateTracksMeta,
      patchTracks,
      setNotice,
    })
  // Stable like the other editor props: saveSettings is recreated per render,
  // and an unstable identity here would re-render the memoized Editor per keystroke.
  const onResultsWidthChange = useStableCallback((width: number) =>
    saveSettings({ resultsWidth: width }),
  )

  // The results column width the editor actually renders at (the match-preset default
  // until the user first sizes it) — the same fallback DiscogsPanel seeds its resize hook with.
  const resultsWidth = settings?.resultsWidth ?? DEFAULT_RESULTS_WIDTH
  // Applies a header focus preset: parks the results column at the preset's width in one
  // click (the editor, flex-1, takes the rest). The list is left where the user dragged it.
  // Saved directly, since the editor reads its width from settings.
  const applyFocusPreset = useStableCallback((id: FocusPresetId) =>
    saveSettings({ resultsWidth: focusPresetWidth(id) }),
  )
  // Which preset the results column currently matches (null once a drag lands between
  // presets), so the header control lights the active one and clears when the user drags off.
  const focusPreset = activeFocusPreset(resultsWidth)

  // Stable like the other editor props so a search keystroke doesn't re-render the
  // memoized Editor: records which track's field has focus for the sweep's edit guard.
  const onFieldFocusChange = useStableCallback((id: string | null) => {
    editingRef.current = id
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
  // stays silent from the other. It is also the single funnel that confirms an in-place
  // overwrite, so a single convert asks the same question a batch does regardless of the
  // entry point (button or ⌘⏎), and never fires straight into an irreversible write.
  const convertSelected = useStableCallback(
    (
      id: string,
      format?: FormatSetting,
      normalize?: NormalizeConfig,
      forceReencode?: boolean,
      destination?: Destination,
      declick?: DeclickMode,
      // Runs the moment the conversion actually starts — immediately when it fires straight
      // through, or on confirm when an in-place overwrite asks first. process-current uses it
      // to advance the selection only once the run commits, so a cancelled confirm doesn't
      // step past the track and the advance never lands behind the open dialog.
      onStarted?: () => void,
    ) => {
      askConvertOne(
        () => {
          onStarted?.()
          void processOne(
            id,
            format,
            normalize,
            undefined,
            forceReencode,
            destination,
            declick,
          ).then((outcome) => {
            if (outcome === 'converted') void maybeShowDonateNudge()
          })
        },
        {
          destination,
          track: tracksRef.current.find((t) => t.id === id),
          format,
          normalize,
          declick,
        },
      )
    },
  )
  const onCancelSelected = useStableCallback(() => {
    if (selected) cancelOne(selected.id)
  })
  const onProcessSelected = useStableCallback((format: OutputFormat) => {
    if (selected)
      void convertSelected(
        selected.id,
        format,
        editorNormalizeRef.current ?? undefined,
        undefined,
        editorDestinationRef.current ?? undefined,
        editorDeclickRef.current ?? undefined,
      )
  })
  // The editor's explicit "Re-encode": a same-format source rendered again with the
  // pinned quality applied — the only path that sets forceReencode.
  const onReencodeSelected = useStableCallback((format: OutputFormat) => {
    if (selected)
      void convertSelected(
        selected.id,
        format,
        editorNormalizeRef.current ?? undefined,
        true,
        editorDestinationRef.current ?? undefined,
        editorDeclickRef.current ?? undefined,
      )
  })
  const onAddSelectedToAppleMusic = useStableCallback(() => {
    if (selected) void addTrackToAppleMusic(selected.id)
  })
  const onTrashOriginal = useStableCallback(() => {
    if (selected) askDeleteOriginal(selected)
  })
  const onRemoveOldMusicCopy = useStableCallback((stale: StaleLibraryCopy) => {
    if (selected) askRemoveOldMusicCopy(selected, stale)
  })
  const onShowLoudnessHelp = useStableCallback(overlays.openLoudnessHelp)
  const onOpenRename = useStableCallback(overlays.openRename)
  // Rebuilds file names from the Settings pattern over the whole selection when there
  // is one (djotas's flow: retag a crate, then stamp every name at once), else the
  // selected track alone. Multi reports a count — the File name section that shows a
  // single rename land is hidden there, so the toast is the only feedback.
  const onRegenerateName = useStableCallback(() => {
    const targets = editScope(selectedTracks, selected)
    const patches = outputNamePatches(settings?.filenameFormat ?? '{artist} - {title}', targets)
    for (const p of patches) updateTrack(p.id, { outputName: p.outputName })
    if (targets.length > 1) setNotice(tr('notices.regeneratedNames', { count: patches.length }))
  })
  // Runs the trim section's silence detection over the whole selection and stages
  // each track's suggestion in one press — the same "detect, then the user
  // confirmed seconds are what converts" contract, just confirmed in bulk. Tracks
  // with a trim already staged are left alone: a hand-adjusted cut must never be
  // clobbered by a re-detection. Waveforms decode through the same query cache the
  // strips use (and main's analysis limiter paces), sequentially so a big selection
  // doesn't starve the analyses the visible editor is waiting on.
  const onTrimDetected = useStableCallback(async () => {
    const scope = editScope(selectedTracks, selected)
    const targets = scope.filter((t) => !t.trim)
    if (targets.length === 0) return
    if (targets.length > 1) setNotice(tr('notices.trimDetecting', { count: targets.length }))
    let applied = 0
    for (const t of targets) {
      try {
        const wave = await queryClient.fetchQuery(waveformOptions(t.inputPath))
        const suggestion = wave ? detectTrim(wave) : undefined
        if (suggestion) {
          updateTrack(t.id, { trim: suggestion })
          applied++
        }
      } catch {
        // A failed decode counts as "nothing to trim" for this track; the summary
        // notice below still reports honestly how many were actually cut.
      }
    }
    setNotice(tr('notices.trimApplied', { count: applied }))
  })
  // The fire-and-forget face of the sweep above, identity-stable like every other
  // Editor/command prop so the memoized editor never re-renders for it.
  const onTrimDetectedAll = useStableCallback(() => {
    void onTrimDetected()
  })
  // The copy button's one-click twin: opens a Google search for the same name in the
  // default browser. window.open routes through the main process's window-open handler
  // (shell.openExternal), the same path every external link takes. The editor button acts
  // on the current selection; the track context menu passes the right-clicked track.
  const searchTrackWeb = useStableCallback((track: TrackItem) => {
    const name = renderOutputName(settings?.filenameFormat ?? '{artist} - {title}', track.meta)
    if (name) {
      const query = name.split('/').pop() ?? name
      window.open(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
    }
  })
  const onSearchWeb = useStableCallback(() => {
    if (selected) searchTrackWeb(selected)
  })
  // What the right-click menu offers is App's decision (its actions route through the
  // confirm dialog, the toasts and the clipboard state up here); when and where it opens
  // stays TrackList's. Stable so the memoized list never re-renders for a handler change.
  const renderTrackMenu = useStableCallback(
    (menu: TrackMenuState, close: () => void): React.ReactNode => (
      <TrackContextMenu
        track={menu.track}
        x={menu.x}
        y={menu.y}
        onClose={close}
        onSearch={onSearchTrack}
        onSearchWeb={searchTrackWeb}
        onStartOver={startOverTrack}
        onCopyMeta={onCopyMeta}
        onCopyPath={onCopyPath}
        onPasteMeta={onPasteMeta}
        canPasteMeta={copiedMeta !== null}
        onRemove={removeFromList}
        onTrash={onTrashRow}
      />
    ),
  )
  // ⌘K twins of the Editor's Eraser / Tag buttons, acting on the current selection so they
  // work without the editor focused. clearMeta mirrors clearAllMeta (single-track clear also
  // un-matches and re-probes); deriveTags mirrors deriveFromNames over the selection.
  const clearMeta = useStableCallback(() => {
    if (!selected) return
    recordMetaUndo(selectedTracks.length > 1 ? selectedIds : [selected.id])
    if (selectedTracks.length > 1) {
      updateTracksMeta(selectedIds, emptyMetadata())
      onClearExtras(selectedIds)
    } else
      updateTrack(selected.id, {
        meta: emptyMetadata(),
        matched: false,
        matchReview: false,
        reviewMatch: undefined,
        matchProvider: undefined,
        inLibraryResolved: false,
        coverRemoved: true,
        metaCleared: true,
      })
  })
  const deriveTags = useStableCallback(() => {
    const targets = editScope(selectedTracks, selected)
    const patches = deriveTagPatches(targets)
    if (patches.length) deriveTracksUndoable(patches)
  })
  // Stamps 1..N (list order) onto the bulk scope's track numbers — the album fix for
  // rips with no Discogs release to take positions from. Plain digits on purpose: the
  // zero-pad hygiene pass formats them at write time like every other track number.
  const numberTracks = useStableCallback(() => {
    const targets = bulkTracksRef.current
    if (targets.length < 2) return
    deriveTracksUndoable(
      targets.map((t, i) => ({ id: t.id, meta: { trackNumber: String(i + 1) } })),
    )
    setNotice(tr('notices.numberedTracks', { count: targets.length }))
  })
  // Rewrites each selected title from the settings' title format — the same one-shot
  // rebuild the title field's ⋯ menu offers, over the whole selection. Tracks whose
  // rendered title is empty, unchanged or already wearing the pattern are skipped
  // (titleFormatPatches), so a double press never stacks the prefix.
  const applyTitleFormat = useStableCallback(() => {
    const format = settings?.titleFormat ?? ''
    if (!format.trim()) return
    const targets = editScope(selectedTracks, selected)
    const { patches, skipped, missingFields } = titleFormatSummary(format, targets)
    // A silent no-op reads as a broken button — say WHY nothing changed: name the
    // pattern field that is empty on these tracks when that's the cause (worded by
    // track count, "this track" vs "these tracks"), else the titles already wear
    // the format. And a partial pass must not celebrate as a full one: report how
    // many tracks were left untouched.
    if (patches.length === 0) {
      setNotice(
        missingFields.length > 0
          ? tr('notices.titleFormatMissing', {
              fields: missingFields.map((key) => tr(`fields.${key}`)).join(', '),
              count: targets.length,
            })
          : tr('notices.titleFormatApplied', { count: targets.length }),
      )
      return
    }
    deriveTracksUndoable(patches)
    setNotice(
      skipped > 0
        ? tr('notices.titleFormattedPartial', { count: patches.length, skipped })
        : tr('notices.titleFormatted', { count: patches.length }),
    )
  })
  // ⌘Z: rolls back the last batch tag operation and says how many rows came back —
  // silence would leave the user unsure whether anything was restored.
  const undoMeta = useStableCallback(() => {
    const count = metaUndo.undo()
    if (count > 0) setNotice(tr('notices.undoneMeta', { count }))
  })
  // Accepts the selected track's pending 'review' suggestion straight from the list, applying
  // the stored release exactly like clicking it in the editor. A no-op when there's nothing to
  // accept, so the command's enabled gate and this stay in agreement.
  const acceptReview = useStableCallback(() => {
    if (!selected) return
    const patch = acceptReviewPatch(selected)
    if (patch && selected.reviewMatch) {
      updateTrack(selected.id, patch)
      window.api.recordStat(matchStatKey(selected.reviewMatch.release.provider))
    }
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
      batching,
      cancelBatch,
      editorFormatRef,
      editorDestinationRef,
      editorNormalizeRef,
      editorDeclickRef,
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
      playerVisible,
      seek,
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
      bulkTracks,
      askTrashSuspects: onTrashSuspects,
      askTrashSelected: onTrashSelected,
      openSettings,
      openFindReplace: overlays.openFindReplace,
      openStripNumbering: overlays.openStripNumbering,
      openExport: overlays.openExport,
      openRename: overlays.openRename,
      openActivity: () => setActivityOpen(true),
      openHelp: overlays.openHelp,
      toggleLanguage: () => void i18n.changeLanguage(nextLocale(i18n.language)),
      toggleTheme,
      clearMeta,
      deriveTags,
      numberTracks,
      applyTitleFormat,
      regenerateNames: onRegenerateName,
      trimDetected: onTrimDetectedAll,
      titleFormatSet: !!settings?.titleFormat?.trim(),
      undoMeta,
      canUndoMeta: metaUndo.canUndo,
      acceptReview,
      fireConfetti,
    }),
  )

  // Escape closes the topmost overlay if one is open; otherwise it clears the selection so
  // a stray highlight (and its editor pane) can be dismissed with the same key. Onboarding
  // is deliberately omitted from the close: it forces a deliberate choice, not an Escape
  // dismissal. Deselect is skipped while a field is focused so Escape stays a field action
  // (cancel an edit, close a field's own popover) instead of yanking the editor away.
  const { maximized } = useMaximizedSection()
  function onEscape(): void {
    if (activeModal) {
      if (activeModal.type === 'onboarding') return
      if (activeModal.type === 'settings') setThemePreview(null)
      overlays.close()
      return
    }
    // A maximized editor section is an overlay layer too: its own listener
    // restores it, and Escape must stop there — falling through would ALSO
    // clear the selection, unmounting the editor mid-review.
    if (maximized !== null) return
    if (isTypingTarget(document.activeElement)) return
    if (selection.ids.length > 0) setSelection({ ids: [], anchor: null })
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
    onEscape,
    onStepTrack: moveSelection,
  })

  // Memoized so the O(n) "any row still reading its tags?" scan runs only when the list
  // changes, not on every App render — the same frequent-render concern as `selected` above.
  const anyLoadingMeta = useMemo(() => tracks.some((t) => t.loadingMeta), [tracks])
  // Drives the slim top bar: the analyze/auto-match/convert sweeps pool their progress,
  // and a fresh drop still reading its tags shows as an indeterminate run.
  const progress = topBarProgress(
    [analysis, matching, batchProgress, importProgress],
    anyLoadingMeta,
  )

  return (
    <SettingsProvider settings={settings}>
      <OpenSettingsProvider open={onOpenSettings}>
        <ToastProvider value={toastReporter}>
          {/* Drag-and-drop is a pointer-only convenience; the "Add files" button is the
          keyboard-accessible path to the same action. */}
          {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control */}
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
                hintFor={hintFor}
                trackCount={tracks.length}
                focusPreset={focusPreset}
                onFocusPreset={applyFocusPreset}
                importing={importProgress}
                batchSummary={batchSummary}
                batching={batching}
                batchProgress={batchProgress}
                analysis={analysis}
                allAnalyzed={allAnalyzed}
                matching={matching}
                hasToken={!!settings?.discogsToken}
                needsToken={needsToken}
                autoMatchable={autoMatchable}
                onAnalyzeAll={onAnalyzeAll}
                onCancelAnalyze={cancelAnalysis}
                onAutoMatch={onAutoMatchAll}
                onCancelAutoMatch={cancelAutoMatch}
                onFixToken={onFixToken}
                onCancelBatch={cancelBatch}
                onPalette={onOpenPalette}
                onStats={onOpenStats}
                onActivity={onToggleActivity}
                activityRunning={activityRows.some((r) => r.status === 'running')}
                onSettings={onOpenSettings}
              />
            </div>

            <div className="flex min-h-0 flex-1">
              <aside
                style={{ width: sidebar.width }}
                className="relative flex min-h-0 shrink-0 flex-col bg-[var(--color-panel)]"
              >
                <div ref={listScrollRef} className="min-h-0 flex-1 overflow-y-auto">
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
                      <TrackListHeader
                        tr={tr}
                        hintFor={hintFor}
                        search={search}
                        setSearch={setSearch}
                        trackSearchRef={trackSearchRef}
                        qualityFilterRef={qualityFilterRef}
                        filterSelection={filterSelection}
                        setFilterSelection={setFilterSelection}
                        librarySource={librarySource}
                        qualityTally={qualityTally}
                        formatTally={formatTally}
                        sortBy={sortBy}
                        setSortBy={setSortBy}
                        sortDir={sortDir}
                        toggleSortDir={toggleSortDir}
                        tracks={tracks}
                        visibleTracks={visibleTracks}
                        selectedId={selectedId}
                        selectedIds={selectedIds}
                        selectedPosition={selectedPosition}
                        onAdd={onAdd}
                        onSelectAllTracks={onSelectAllTracks}
                        scrollToSelected={scrollToSelected}
                        onFillAll={onFillAll}
                        onFindReplace={onFindReplace}
                        onClearAll={onClearAll}
                        onTrashSelected={onTrashSelected}
                        onTrashSuspects={onTrashSuspects}
                      />
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
                          outputFormat={
                            settings?.outputFormat === 'source'
                              ? 'aiff'
                              : (settings?.outputFormat ?? 'aiff')
                          }
                          onSelect={onSelectTrack}
                          onActivate={toggleTrack}
                          onRemove={removeFromList}
                          onPrefetch={handlePrefetch}
                          renderMenu={renderTrackMenu}
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
                    onReveal={() => revealSelection(playerTrack.id)}
                    onClose={closePlayer}
                  />
                )}
              </aside>

              <ResizeHandle
                onPointerDown={sidebar.onPointerDown}
                // Fitting to content only means something once there are track names to
                // measure; on an empty list the gesture is a no-op, so drop it and its hint.
                onDoubleClick={tracks.length > 0 ? autoFitSidebar : undefined}
                title={tracks.length > 0 ? tr('sidebar.fitHint') : undefined}
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
                      searchInputRef={searchInputRef}
                      selectedTracks={selectedTracks}
                      onApplyMatches={onApplyMatches}
                      onProcessAll={onProcessAllSelected}
                      onAddAllToAppleMusic={onAddAllSelectedToAppleMusic}
                      onChangeAllMeta={onChangeAllMeta}
                      onApplyCoverAll={onApplyCoverAll}
                      onDeriveTags={deriveTracksUndoable}
                      onApplyTitleFormat={applyTitleFormat}
                      onRecordUndo={recordMetaUndo}
                      onClearExtras={onClearExtras}
                      onFieldFocusChange={onFieldFocusChange}
                      onChange={onEditorChange}
                      onProcess={onProcessSelected}
                      onCancel={onCancelSelected}
                      onReencode={onReencodeSelected}
                      onFormatChange={onFormatChange}
                      onDestinationChange={onDestinationChange}
                      onNormalizeChange={onNormalizeChange}
                      onDeclickChange={onDeclickChange}
                      onAddToAppleMusic={onAddSelectedToAppleMusic}
                      onTrashOriginal={onTrashOriginal}
                      onRemoveOldMusicCopy={onRemoveOldMusicCopy}
                      onResultsWidthChange={onResultsWidthChange}
                      onShowLoudnessHelp={onShowLoudnessHelp}
                      onOpenRename={onOpenRename}
                      onRegenerateName={onRegenerateName}
                      onTrimDetectedAll={onTrimDetectedAll}
                      onCopyFilename={onCopyFilename}
                      onSearchWeb={onSearchWeb}
                      onExportCollection={onOpenExport}
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
                          window.api.platform === 'darwin'
                            ? 'empty.subtitle'
                            : 'empty.subtitleNoMusic',
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
            <Overlays
              activeModal={activeModal}
              settings={settings}
              selected={selected}
              bulkTracks={bulkTracks}
              visibleTracks={visibleTracks}
              getCommands={getCommands}
              editorFormatRef={editorFormatRef}
              close={overlays.close}
              closeIfPalette={overlays.closeIfPalette}
              closeSettings={closeSettings}
              saveSettings={saveSettings}
              setSettings={setSettings}
              setThemePreview={setThemePreview}
              finishOnboarding={finishOnboarding}
              deriveTracksUndoable={deriveTracksUndoable}
              updateTrack={updateTrack}
              revealSelection={revealSelection}
            />

            <ToastStack toasts={toasts} onExpire={expireToast} onClose={closeToast} />
            {activityOpen && (
              <ActivityPanel
                rows={activityRows}
                onClear={clearActivity}
                onClose={() => setActivityOpen(false)}
                onCopy={(text) => {
                  void window.api.copyText(text)
                  setNotice(tr('notices.copiedActivity'))
                }}
                geometry={clampPanelGeometry(settings?.activityPanel, {
                  width: window.innerWidth,
                  height: window.innerHeight,
                })}
                onGeometryChange={(g) =>
                  saveSettings({
                    activityPanel: {
                      x: g.pos.x,
                      y: g.pos.y,
                      width: g.size.width,
                      height: g.size.height,
                    },
                  })
                }
              />
            )}
            {confettiBurst > 0 && <Confetti key={confettiBurst} />}
          </div>
        </ToastProvider>
      </OpenSettingsProvider>
    </SettingsProvider>
  )
}
