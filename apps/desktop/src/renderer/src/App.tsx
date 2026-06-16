import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  AudioLines,
  CircleCheckBig,
  List,
  type LucideIcon,
  RefreshCw,
  Search,
  Sparkles,
  TriangleAlert,
  X,
} from 'lucide-react'
import type React from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveBindings } from '../../shared/shortcutDefaults'
import type {
  NormalizeConfig,
  OutputFormat,
  Settings,
  SpectrumResult,
  TrackMetadata,
} from '../../shared/types'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ErrorToast } from './components/ErrorToast'
import { NoticeToast } from './components/NoticeToast'
import { LivePlayer } from './components/Player'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { Select } from './components/Select'
import { Toolbar } from './components/Toolbar'
import { Tooltip } from './components/Tooltip'
import { TopProgressBar } from './components/TopProgressBar'
import { TrackList } from './components/TrackList'
import { UpdateToast } from './components/UpdateToast'
import { useAutoMatch } from './hooks/useAutoMatch'
import { useDockPlayingIndicator } from './hooks/useDockPlayingIndicator'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { usePlayer } from './hooks/usePlayer'
import { useQualityAnalysis } from './hooks/useQualityAnalysis'
import { useSettings } from './hooks/useSettings'
import { spectrogramOptions } from './hooks/useSpectrogram'
import { useStableCallback } from './hooks/useStableCallback'
import { useTrackLibrary } from './hooks/useTrackLibrary'
import { useTrackProcessing } from './hooks/useTrackProcessing'
import { waveformOptions } from './hooks/useWaveform'
import { nextLocale } from './i18n/locale'
import { removeAnalysisQueries } from './lib/analysisQueries'
import { tracksToAutoMatch } from './lib/autoMatch'
import { canProcessTrack, eligibleForBatch } from './lib/batch'
import { buildCommands, type Command, runCommand } from './lib/commands'
import { revokeCoverUrl } from './lib/coverUrl'
import { smartDeriveTags } from './lib/deriveTags'
import { shouldShowDonateNudge } from './lib/donateNudge'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from './lib/fields'
import { moveIndex } from './lib/keymap'
import { shouldShowOnboarding } from './lib/onboarding'
import { renderOutputName } from './lib/outputName'
import { needsDiscogsPrefetch } from './lib/prefetch'
import { applyProgress, topBarProgress } from './lib/progress'
import type { ReleaseMetaPatch } from './lib/release'
import { contentDeficit } from './lib/resize'
import { pageScrollTop } from './lib/scroll'
import { type ClickMods, clickSelect, type Selection } from './lib/selection'
import { formatShortcut } from './lib/shortcuts'
import {
  filterByQuality,
  matchesSearch,
  type QualityFilter,
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

// Warms the main-process Discogs caches for a hovered track: the search the editor
// runs on open, plus the top release behind it. Both are cached by the main
// process, so opening the track (and clicking that release) then hits no network.
async function warmDiscogs(query: string): Promise<void> {
  // Background warming yields to the editor's own search, so it acquires at low priority.
  const results = await window.api.searchDiscogs(query, undefined, 'low')
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

// One Lucide glyph per list-filter chip, kept visually consistent with the toolbar.
const FILTER_ICONS: Record<QualityFilter, LucideIcon> = {
  all: List,
  suspect: TriangleAlert,
  good: CircleCheckBig,
  unanalyzed: AudioLines,
  unconverted: RefreshCw,
  automatched: Sparkles,
}

type SettingsTab = 'general' | 'stats' | 'naming' | 'shortcuts'

interface ConfirmModal {
  title: string
  message: string
  confirmLabel: string
  confirmDisabled?: boolean
  destructive?: boolean
  onConfirm: () => void
}

// The one modal/overlay currently open, or null. A single discriminated union (instead
// of a boolean per modal) makes the "only one open at a time" invariant impossible to
// break, and lets the keyboard/overlay logic read a single value.
type ActiveModal =
  | { type: 'settings'; tab: SettingsTab }
  | { type: 'onboarding' }
  | { type: 'donateNudge' }
  | { type: 'help' }
  | { type: 'loudnessHelp' }
  | { type: 'findReplace' }
  | { type: 'rename' }
  | { type: 'export' }
  | { type: 'palette' }
  | { type: 'confirm'; confirm: ConfirmModal }
  | null

export default function App(): React.JSX.Element {
  const { t: tr, i18n } = useTranslation()
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null })
  const selectedId = selection.anchor
  const selectedIds = selection.ids
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  // A surfaced background failure (a rejected IPC call, an unhandled rejection),
  // stored as a key plus interpolation detail and localized at render so a language
  // switch retranslates it.
  const [appError, setAppError] = useState<{
    kind: 'unexpected' | 'settingsLoad' | 'settingsSave' | 'trash'
    detail?: string
  } | null>(null)
  // A transient, non-blocking status line (e.g. "skipped N already-added files"). Unlike
  // appError it clears itself, so it never lingers after the user has moved on.
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(id)
  }, [notice])
  // Persisted settings (initial load, modal-open refresh, theme application,
  // optimistic save) live in the hook; App only decides the launch modal.
  const settingsOpen = activeModal?.type === 'settings'
  const { settings, setSettings, saveSettings, setThemePreview } = useSettings({
    settingsOpen,
    onFirstLoad: (s) => {
      if (shouldShowOnboarding(s)) setActiveModal({ type: 'onboarding' })
      else if (shouldShowDonateNudge(s, new Date(), Math.random())) {
        setActiveModal({ type: 'donateNudge' })
        // Stamp the showing immediately, not on close, so a quick quit still
        // counts toward the cooldown and the nudge can never appear twice in a
        // row. Straight to the bridge: only the next launch reads this value,
        // so the renderer settings state doesn't need the refresh.
        void window.api.saveSettings({ donateNudgeLastShown: new Date().toISOString() })
      }
    },
    onLoadError: () => setAppError({ kind: 'settingsLoad' }),
    onSaveError: () => setAppError({ kind: 'settingsSave' }),
  })
  // Quality triage view filter: narrows the list to suspect or unanalyzed tracks so a
  // big crate can be swept for fakes without scrolling past the clean ones.
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  // Free-text filter over the imported tracks, combined with the quality chip above.
  // Narrows a big dropped crate by name/artist/album without converting anything.
  const [search, setSearch] = useState('')
  // Display order of the (filtered) list. Defaults to the drop order.
  const [sortBy, setSortBy] = useState<TrackSort>('import')
  const [dragging, setDragging] = useState(false)
  // Metadata copied from one track's context menu, to stamp onto another. Null until
  // the user copies, which is what gates the paste item in the row menu.
  const [copiedMeta, setCopiedMeta] = useState<TrackMetadata | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
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
  const hasTokenRef = useRef(false)
  hasTokenRef.current = !!settings?.discogsToken
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queryClient = useQueryClient()
  // The latest spectrum-merged view of the tracks, so the hover-prefetch and analyze
  // callbacks (which read refs to stay stable) can see each track's cached spectrum
  // without re-subscribing.
  const tracksViewRef = useRef<TrackItem[]>([])
  // Merging a cached spectrum onto a track mints a new object; caching it by id keeps
  // the reference stable across renders so memoized rows only re-render when their own
  // spectrum lands.
  const viewCache = useRef(
    new Map<string, { track: TrackItem; spectrum: SpectrumResult; view: TrackItem }>(),
  )
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
  }, [])

  // The native menu triggers actions by command id, the same registry the
  // palette and keyboard shortcuts use, so the three surfaces never drift apart.
  // Opening the palette is the one exception: it's a UI affordance, not a track
  // command, so it never lists itself.
  useEffect(
    () =>
      window.api.onMenuCommand((id) => {
        if (id === 'palette') setActiveModal({ type: 'palette' })
        else runCommand(commandsRef.current, id)
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
    clearTracks,
  } = useTrackLibrary({
    setSelection,
    onForget: (id) => {
      discogsPrefetched.current.delete(id)
      viewCache.current.delete(id)
      forgetAutoMatch(id)
      revokeCoverUrl(tracksRef.current.find((t) => t.id === id)?.coverUrl)
    },
    // A row leaving the list also evicts its probe results from the session-long
    // query cache, where the spectrogram image would otherwise be retained until quit.
    onRemove: (track) => {
      discogsPrefetched.current.delete(track.id)
      viewCache.current.delete(track.id)
      forgetAutoMatch(track.id)
      removeAnalysisQueries(queryClient, track.inputPath)
      // A picked cover's blob URL would otherwise pin the image file until quit.
      revokeCoverUrl(track.coverUrl)
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
      // Enqueue the whole crate (not visible-only): with auto-match on, every imported
      // track gets matched, the sweep just probes the on-screen rows first.
      if (settings?.autoMatch && settings.discogsToken) enqueueAutoMatch([t], false)
    },
    onDuplicatesSkipped: (count) => setNotice(tr('notices.duplicatesSkipped', { count })),
  })

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [setTracks],
  )

  const onSelectTrack = useCallback(
    (id: string, mods: ClickMods): void => {
      const order = tracksRef.current.map((t) => t.id)
      setSelection((s) => clickSelect(s, order, id, mods))
    },
    [tracksRef],
  )

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
        // The waveform is always shown the moment playback opens the player, and it is
        // the heaviest decode (whole file), so warm it for every rested hover.
        void queryClient.prefetchQuery(waveformOptions(track.inputPath))
        if (showSpectrumRef.current) {
          void queryClient.prefetchQuery(spectrogramOptions(track.inputPath))
        }
        if (
          needsDiscogsPrefetch(track, hasTokenRef.current) &&
          !discogsPrefetched.current.has(id)
        ) {
          discogsPrefetched.current.add(id)
          warmDiscogs(track.query).catch(() => discogsPrefetched.current.delete(id))
        }
      }, PREFETCH_HOVER_MS)
    },
    [queryClient, tracksRef],
  )

  // Batch quality triage (progress, cancel, focus gating) lives in the hook; App only
  // wires the start/cancel actions into the toolbar and commands.
  const { analysis, analyzeAllQuality, cancelAnalysis } = useQualityAnalysis({ tracksViewRef })

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
  } = useAutoMatch({ tracksRef, updateTrack })

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
  useEffect(() => {
    if (!settings?.autoMatch || !settings.discogsToken || !selectedId) return
    const id = setTimeout(() => {
      const track = tracksRef.current.find((t) => t.id === selectedId)
      if (track) enqueueAutoMatch([track], false)
    }, 500)
    return () => clearTimeout(id)
  }, [selectedId, settings?.autoMatch, settings?.discogsToken, enqueueAutoMatch, tracksRef])

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

  // Right-click "Move to Trash": confirm first, then send each original file to the OS
  // Trash/Recycle Bin and drop its row only once that succeeds, so a failure leaves that
  // row untouched. Copy switches on platform because the destination differs, and on
  // count so a multi-selection reads "N files" instead of naming just one.
  function askTrash(targets: TrackItem[]): void {
    if (targets.length === 0) return
    const isWin = window.api.platform === 'win32'
    const count = targets.length
    askConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle', { count }),
      message: tr(isWin ? 'confirm.trashMessageWin' : 'confirm.trashMessage', {
        count,
        name: targets[0].fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        for (const track of targets) {
          window.api
            .trashFile(track.inputPath)
            .then(() => removeTrack(track.id))
            // The user confirmed a destructive dialog; a silent failure here reads
            // as "the file is in the trash" when it isn't.
            .catch(() => setAppError({ kind: 'trash', detail: track.fileName }))
        }
      },
    })
  }

  // Post-convert "Delete original": a real conversion leaves the source file beside the
  // converted copy, so this reclaims the disk. Confirm, send the original to the OS
  // Trash/Recycle Bin (recoverable), then mark the row so the button disappears — unlike
  // askTrash the row stays, because the converted output it points at is still there.
  function askDeleteOriginal(track: TrackItem): void {
    const isWin = window.api.platform === 'win32'
    askConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle'),
      message: tr(isWin ? 'confirm.deleteOriginalMessageWin' : 'confirm.deleteOriginalMessage', {
        name: track.fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        window.api
          .trashFile(track.inputPath)
          .then(() => updateTrack(track.id, { originalTrashed: true }))
          // Same as askTrash: the user confirmed a destructive dialog, so a
          // failure must be said out loud, not swallowed.
          .catch(() => setAppError({ kind: 'trash', detail: track.fileName }))
      },
    })
  }

  function selectAll(): void {
    if (tracks.length === 0) return
    setSelection({ ids: tracks.map((t) => t.id), anchor: tracks[0].id })
  }

  // Fills every loaded track's tags from its own file name — the mouse-driven counterpart
  // of the editor's per-track "Fill from filename", for cleaning a whole import at once.
  function deriveAll(): void {
    const patches = tracks
      .map((t) => ({ id: t.id, meta: smartDeriveTags(t.fileName) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) deriveTracks(patches)
  }

  // Fill-all and Clear-all both overwrite/discard work across the whole list, so they ask
  // first rather than firing on the click; the dialog spells out exactly what changes.
  function askFillAll(): void {
    const count = tracks.filter((t) => Object.keys(smartDeriveTags(t.fileName)).length > 0).length
    askConfirm({
      title: tr('confirm.fillTitle'),
      message: count > 0 ? tr('confirm.fillMessage', { count }) : tr('confirm.fillNone'),
      confirmLabel: tr('confirm.fillConfirm'),
      confirmDisabled: count === 0,
      onConfirm: deriveAll,
    })
  }

  function askClearAll(): void {
    askConfirm({
      title: tr('confirm.clearTitle'),
      message: tr('confirm.clearMessage', { count: tracks.length }),
      confirmLabel: tr('confirm.clearConfirm'),
      destructive: true,
      onConfirm: clearTracks,
    })
  }

  // Overwrite mode rewrites each source in place (the original is unlinked, not
  // trashed), so a batch run asks once before touching N files. The editor carries
  // the same warning per track; outside overwrite mode the batch stays one-click
  // because conversion only writes new files.
  function askConvertAll(
    targets: TrackItem[],
    format?: OutputFormat,
    normalize?: NormalizeConfig,
  ): void {
    if (!settings?.overwriteOriginal) {
      void processAll(targets, format, normalize)
      return
    }
    askConfirm({
      title: tr('confirm.convertInPlaceTitle'),
      message: tr('confirm.convertInPlaceMessage', { count: eligibleForBatch(targets).length }),
      confirmLabel: tr('confirm.convertInPlaceConfirm'),
      destructive: true,
      onConfirm: () => void processAll(targets, format, normalize),
    })
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
  } = useTrackProcessing({
    tracks,
    settings,
    updateTrack,
  })

  function openSettings(tab: SettingsTab = 'general'): void {
    setActiveModal({ type: 'settings', tab })
  }

  function closeSettings(): void {
    setActiveModal(null)
    setThemePreview(null)
  }

  function finishOnboarding(patch: Partial<Settings>): void {
    saveSettings(patch)
    setActiveModal(null)
  }

  function askConfirm(confirm: ConfirmModal): void {
    setActiveModal({ type: 'confirm', confirm })
  }

  function moveSelection(delta: number): void {
    // Step through the rows the user can actually see (after the quality filter and the
    // search), so arrow/j-k navigation never lands on a track hidden by the current view —
    // and so the index lines up with the rendered rows queried below.
    const next = moveIndex(
      visibleTracks.length,
      visibleTracks.findIndex((t) => t.id === selectedId),
      delta,
    )
    if (next === -1) return
    setSelection({ ids: [visibleTracks[next].id], anchor: visibleTracks[next].id })
    // Move DOM focus with the selection so the native focus ring follows the
    // keyboard instead of staying on the last clicked row, which left two rows
    // looking highlighted at once. preventScroll: we page the list ourselves below
    // rather than let the browser nudge the row flush to the margin.
    const row = rowEls.current.get(visibleTracks[next].id)
    if (!row) return
    row.focus({ preventScroll: true })
    const container = listScrollRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const header = qualityFilterRef.current
    const top = pageScrollTop({
      delta,
      rowTop: rRect.top - cRect.top,
      rowBottom: rRect.bottom - cRect.top,
      viewport: container.clientHeight,
      headerH: header?.offsetHeight ?? 0,
      // The floating player reserves the list's bottom 128px (pb-32 above).
      footerH: playerVisible && playerTrack ? 128 : 0,
      rowStep: rRect.height + 4, // row height + the gap-1 between rows
      scrollTop: container.scrollTop,
    })
    // Ease into the new page rather than snapping, so the eye can follow the jump.
    if (top !== null) container.scrollTo({ top, behavior: 'smooth' })
  }

  // When a track finishes: in continuous mode advance to the next visible track —
  // the selection-follows-playback effect plays it and moveSelection scrolls it
  // into view. Otherwise, or once the list runs out, close the player.
  function onTrackEnded(): void {
    const idx = visibleTracks.findIndex((t) => t.id === selectedId)
    if (settings?.continuousPlayback && idx >= 0 && idx + 1 < visibleTracks.length) {
      moveSelection(1)
    } else {
      closePlayer()
    }
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
  const { audioRef, playerVisible, playerTrack, togglePlay, openWith, closePlayer } = usePlayer({
    tracks,
    selected,
    selectedId,
  })
  // While audio plays, the Dock icon's engraved wave animates (macOS only).
  useDockPlayingIndicator(audioRef)

  const canProcessSelected =
    !!selected && canProcessTrack(selected, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  const eligibleCount = useMemo(() => eligibleForBatch(tracks).length, [tracks])
  const selectedEligibleCount = useMemo(
    () => eligibleForBatch(selectedTracks).length,
    [selectedTracks],
  )

  // Each track's spectrum, read from the shared React Query cache the hover prefetch,
  // the analyze sweep and the editor all fill. enabled:false so the list only observes —
  // it never triggers an analysis itself. combine matters: its output is cached by the
  // observer until an underlying result changes, so this hook keeps a stable identity
  // across unrelated renders — without it, useQueries returns a fresh array per render,
  // which broke the tracksView memo below and re-ran the whole triage pipeline on every
  // keystroke and progress tick.
  const spectra = useQueries({
    queries: tracks.map((t) => ({
      ...spectrogramOptions(t.inputPath),
      enabled: false,
    })),
    combine: (results) => results.map((r) => ({ data: r.data, fetching: r.isFetching })),
  })
  // Merge each cached spectrum onto its track for the quality triage and the list,
  // preserving object identity (via viewCache) so memoized rows don't all re-render.
  // Memoized so a progress tick during an analyze/convert/match sweep doesn't rebuild
  // the whole list (and re-run the quality/auto-match scans below) on every re-render.
  // A row whose analysis is still in flight gets a transient `analyzing` view so the
  // list can show a placeholder where the verdict dot will land; it is minted per
  // recompute (not cached) because it only exists for the duration of the fetch.
  const tracksView = useMemo(
    () =>
      tracks.map((t, i) => {
        const { data: spectrum, fetching } = spectra[i]
        if (!spectrum) return fetching ? { ...t, analyzing: true } : t
        const cached = viewCache.current.get(t.id)
        if (cached && cached.track === t && cached.spectrum === spectrum) return cached.view
        const view: TrackItem = { ...t, spectrum }
        viewCache.current.set(t.id, { track: t, spectrum, view })
        return view
      }),
    [tracks, spectra],
  )
  tracksViewRef.current = tracksView

  const qualityTally = useMemo(() => qualityCounts(tracksView), [tracksView])
  const visibleTracks = useMemo(
    () =>
      sortTracks(
        filterByQuality(tracksView, qualityFilter).filter((t) => matchesSearch(t, search)),
        sortBy,
      ),
    [tracksView, qualityFilter, search, sortBy],
  )
  // 1-based position of the selected row within the current view, for the "54/200" pill —
  // so a DJ auditioning a crate one by one sees how far along they are. Null when nothing
  // is selected (or the selection was filtered out of view).
  const selectedPosition = useMemo(() => {
    if (!selectedId) return null
    const i = visibleTracks.findIndex((t) => t.id === selectedId)
    return i < 0 ? null : i + 1
  }, [visibleTracks, selectedId])
  // Drives the toolbar auto-match button: how many loaded tracks are still worth a probe,
  // so it disables once every track is matched (or there's nothing to match).
  const autoMatchable = useMemo(() => tracksToAutoMatch(tracksView).length, [tracksView])
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
  const onFillAll = useStableCallback(askFillAll)
  const onFindReplace = useStableCallback(() => setActiveModal({ type: 'findReplace' }))
  const onAnalyzeAll = useStableCallback(analyzeAllQuality)
  const onAutoMatchAll = useStableCallback(() => enqueueAutoMatch(tracksView, false))
  const onConvertSelected = useStableCallback(() => askConvertAll(selectedTracks))
  const onCancelConvert = useStableCallback(cancelBatch)
  const onOpenExport = useStableCallback(() => setActiveModal({ type: 'export' }))
  const onClearAll = useStableCallback(askClearAll)
  const onOpenPalette = useStableCallback(() => setActiveModal({ type: 'palette' }))
  const onOpenStats = useStableCallback(() => openSettings('stats'))
  const onOpenSettings = useStableCallback(openSettings)
  const onApplyMatches = useStableCallback((patches: { id: string; patch: ReleaseMetaPatch }[]) => {
    for (const p of patches) updateTrack(p.id, p.patch)
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
  const onApplyCoverAll = useStableCallback((coverUrl: string, coverPath?: string) =>
    patchTracks(selectedIds, { coverUrl, coverPath }),
  )
  const onEditorChange = useStableCallback((patch: Partial<TrackItem>) => {
    if (selected) updateTrack(selected.id, patch)
  })
  const onProcessSelected = useStableCallback((format: OutputFormat) => {
    if (selected) void processOne(selected.id, format, editorNormalizeRef.current ?? undefined)
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
  const onShowLoudnessHelp = useStableCallback(() => setActiveModal({ type: 'loudnessHelp' }))
  const onOpenRename = useStableCallback(() => setActiveModal({ type: 'rename' }))
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
  // O(N) per evaluation, so computed once per tracksView instead of inline in JSX.
  const allAnalyzed = useMemo(() => tracksView.every((t) => Boolean(t.spectrum)), [tracksView])

  const commands: Command[] = buildCommands({
    tr,
    hintFor,
    tracks,
    tracksView,
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
    searchInputRef,
    pickFiles: () => void pickFiles(),
    selectAll,
    askFillAll,
    moveSelection,
    togglePlay,
    processOne,
    askConvertAll,
    cancelAnalysis,
    analyzeAllQuality,
    cancelAutoMatch,
    enqueueAutoMatch,
    addTrackToAppleMusic,
    removeTrack,
    askClearAll,
    openSettings,
    openFindReplace: () => setActiveModal({ type: 'findReplace' }),
    openExport: () => setActiveModal({ type: 'export' }),
    openRename: () => setActiveModal({ type: 'rename' }),
    openHelp: () => setActiveModal({ type: 'help' }),
    toggleLanguage: () => void i18n.changeLanguage(nextLocale(i18n.language)),
  })

  const commandsRef = useRef<Command[]>(commands)
  commandsRef.current = commands
  // Closes the open overlay on Escape. Onboarding is deliberately omitted: it forces a
  // deliberate choice, not an Escape dismissal.
  function closeTopOverlay(): void {
    if (!activeModal || activeModal.type === 'onboarding') return
    if (activeModal.type === 'settings') setThemePreview(null)
    setActiveModal(null)
  }

  // Any open modal/overlay also swallows the global shortcuts, or space/j/k/⌘⏎ would act
  // on the list behind the dialog (e.g. start a conversion behind the confirm prompt).
  const overlayOpen = activeModal !== null

  useKeyboardShortcuts({
    isMac,
    overlayOpen,
    bindings,
    commands,
    onTogglePalette: () =>
      setActiveModal((m) => (m?.type === 'palette' ? null : { type: 'palette' })),
    onEscape: closeTopOverlay,
  })

  // Drives the slim top bar: the analyze/auto-match/convert sweeps pool their progress,
  // and a fresh drop still reading its tags shows as an indeterminate run.
  const progress = topBarProgress(
    [analysis, matching, batchProgress],
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
          batchSummary={batchSummary}
          batching={batching}
          batchProgress={batchProgress}
          analysis={analysis}
          allAnalyzed={allAnalyzed}
          matching={matching}
          hasToken={!!settings?.discogsToken}
          autoMatchable={autoMatchable}
          selectedEligibleCount={selectedEligibleCount}
          onAdd={onAdd}
          onSelectAll={onSelectAllTracks}
          onFillAll={onFillAll}
          onFindReplace={onFindReplace}
          onAnalyzeAll={onAnalyzeAll}
          onCancelAnalyze={cancelAnalysis}
          onAutoMatch={onAutoMatchAll}
          onCancelAutoMatch={cancelAutoMatch}
          onConvertSelected={onConvertSelected}
          onCancelConvert={onCancelConvert}
          onExport={onOpenExport}
          onClearAll={onClearAll}
          onPalette={onOpenPalette}
          onStats={onOpenStats}
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
              <p className="p-6 text-center text-xs text-fg-faint">{tr('sidebar.dropHint')}</p>
            ) : (
              <>
                <div className="sticky top-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-panel)]">
                  <div className="flex items-center gap-1.5 px-1.5 pt-2">
                    <div className="relative flex-1">
                      <Search
                        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-faint"
                        aria-hidden="true"
                      />
                      <input
                        data-testid="track-search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        aria-label={tr('sidebar.search.placeholder')}
                        placeholder={tr('sidebar.search.placeholder')}
                        className="h-8 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-field)] pl-7 pr-7 text-xs outline-none focus:border-[var(--color-accent)]"
                      />
                      {search && (
                        <button
                          type="button"
                          data-testid="track-search-clear"
                          aria-label={tr('sidebar.search.clear')}
                          onClick={() => setSearch('')}
                          className="press absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-faint hover:text-fg"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    <Select
                      testid="track-sort"
                      value={sortBy}
                      onChange={(v) => setSortBy(v as TrackSort)}
                      label={tr('sidebar.sort.label')}
                      options={[
                        { value: 'import', label: tr('sidebar.sort.import') },
                        { value: 'name', label: tr('sidebar.sort.name') },
                        { value: 'artist', label: tr('sidebar.sort.artist') },
                        { value: 'duration', label: tr('sidebar.sort.duration') },
                      ]}
                    />
                  </div>
                  <div
                    ref={qualityFilterRef}
                    data-testid="quality-filter"
                    className="flex gap-0.5 px-1.5 py-2"
                  >
                    {(
                      [
                        'all',
                        'unanalyzed',
                        'suspect',
                        'good',
                        'unconverted',
                        // Provenance chip, shown only once something has been auto-filled so the
                        // bar isn't cluttered with a permanently-empty filter when auto-match is off.
                        ...(qualityTally.automatched > 0 ? (['automatched'] as const) : []),
                      ] as const
                    ).map((mode) => {
                      const count =
                        mode === 'all'
                          ? tracks.length
                          : mode === 'unanalyzed'
                            ? qualityTally.unanalyzed
                            : mode === 'suspect'
                              ? qualityTally.suspect
                              : mode === 'good'
                                ? qualityTally.good
                                : mode === 'unconverted'
                                  ? qualityTally.unconverted
                                  : qualityTally.automatched
                      const active = qualityFilter === mode
                      const name = tr(`sidebar.filter.${mode}`)
                      const Icon = FILTER_ICONS[mode]
                      // Color-coded dot draws the eye to buckets that need attention: amber for
                      // suspect (likely fake), accent for the still-to-convert backlog.
                      const dot =
                        mode === 'suspect' && qualityTally.suspect > 0
                          ? 'bg-warn'
                          : mode === 'unconverted' && qualityTally.unconverted > 0
                            ? 'bg-[var(--color-accent)]'
                            : null
                      return (
                        <button
                          key={mode}
                          type="button"
                          data-testid={`quality-filter-${mode}`}
                          aria-pressed={active}
                          aria-label={name}
                          onClick={() => setQualityFilter(mode)}
                          className={`press group relative flex shrink-0 items-center gap-0.5 rounded-md px-1 py-1 text-xs font-medium ${
                            active
                              ? 'bg-[var(--color-accent-soft)] text-fg'
                              : 'text-fg-dim hover:bg-[var(--color-panel-2)]'
                          }`}
                        >
                          <span className="relative">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                            {dot && (
                              <span
                                className={`absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full ${dot}`}
                              />
                            )}
                          </span>
                          <span className="min-w-[2ch] text-center tabular-nums opacity-70">
                            {count}
                          </span>
                          <Tooltip label={name} />
                        </button>
                      )
                    })}
                    {selectedPosition !== null && (
                      <span
                        data-testid="track-position"
                        title={tr('sidebar.position', {
                          current: selectedPosition,
                          total: visibleTracks.length,
                        })}
                        className="ml-auto self-center pr-0.5 pl-1 text-xs tabular-nums text-fg-faint"
                      >
                        {selectedPosition}/{visibleTracks.length}
                      </span>
                    )}
                  </div>
                </div>
                {visibleTracks.length === 0 ? (
                  <p className="p-6 text-center text-xs text-fg-faint">
                    {tr('sidebar.search.empty')}
                  </p>
                ) : (
                  <TrackList
                    tracks={visibleTracks}
                    selectedId={selectedId}
                    selectedIds={selectedIds}
                    outputFormat={settings?.outputFormat ?? 'aiff'}
                    onSelect={onSelectTrack}
                    onActivate={openWith}
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
                hasToken={!!settings?.discogsToken}
                outputFormat={settings?.outputFormat ?? 'aiff'}
                addToAppleMusic={settings?.addToAppleMusic ?? false}
                overwriteOriginal={settings?.overwriteOriginal ?? false}
                groupingPresets={settings?.groupingPresets ?? []}
                genrePresets={settings?.genrePresets ?? []}
                visibleFields={settings?.visibleFields ?? DEFAULT_FIELDS}
                requiredFields={settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS}
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
              setActiveModal(null)
            }}
          />
        )}

        {activeModal?.type === 'help' && <HelpModal onClose={() => setActiveModal(null)} />}
        {activeModal?.type === 'loudnessHelp' && (
          <LoudnessHelpModal onClose={() => setActiveModal(null)} />
        )}
        {activeModal?.type === 'findReplace' && (
          <FindReplaceModal
            tracks={tracks}
            onApply={deriveTracks}
            onClose={() => setActiveModal(null)}
          />
        )}
        {activeModal?.type === 'rename' && selected && (
          <RenameModal
            meta={selected.meta}
            initialFormat={settings?.filenameFormat ?? '{artist} - {title}'}
            extension={editorFormatRef.current ?? settings?.outputFormat ?? 'aiff'}
            onApply={(outputName) => updateTrack(selected.id, { outputName })}
            onClose={() => setActiveModal(null)}
          />
        )}
        {activeModal?.type === 'export' && (
          <ExportModal tracks={tracks} onClose={() => setActiveModal(null)} />
        )}
        {activeModal?.type === 'confirm' && (
          <ConfirmDialog
            title={activeModal.confirm.title}
            message={activeModal.confirm.message}
            confirmLabel={activeModal.confirm.confirmLabel}
            confirmDisabled={activeModal.confirm.confirmDisabled}
            destructive={activeModal.confirm.destructive}
            onConfirm={activeModal.confirm.onConfirm}
            onClose={() => setActiveModal(null)}
          />
        )}

        {activeModal?.type === 'palette' && (
          <CommandPalette
            commands={commands}
            // A command's run() may itself open another modal (settings, find & replace,
            // export…). Closing the palette must not clobber that: only dismiss it when the
            // palette is still the active modal, so a command that navigated elsewhere wins.
            onClose={() => setActiveModal((m) => (m?.type === 'palette' ? null : m))}
          />
        )}
      </Suspense>

      {appError && (
        <ErrorToast
          message={tr(`errors.${appError.kind}`, { detail: appError.detail })}
          onDismiss={() => setAppError(null)}
        />
      )}
      {notice && !appError && <NoticeToast message={notice} onDismiss={() => setNotice(null)} />}
      <UpdateToast />
    </div>
  )
}
