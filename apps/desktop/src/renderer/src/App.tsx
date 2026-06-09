import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  AudioLines,
  CircleCheckBig,
  List,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../shared/media'
import { resolveBindings } from '../../shared/shortcutDefaults'
import type {
  NormalizeConfig,
  OutputFormat,
  Settings,
  SpectrumResult,
  ThemePref,
  TrackMetadata,
} from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { ExportModal } from './components/ExportModal'
import { UpgradeModal, type UpgradeReason } from './components/UpgradeModal'
import { FindReplaceModal } from './components/FindReplaceModal'
import { HelpModal } from './components/HelpModal'
import { OnboardingWizard } from './components/OnboardingWizard'
import { LivePlayer } from './components/Player'
import { RenameModal } from './components/RenameModal'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { Toolbar } from './components/Toolbar'
import { Tooltip } from './components/Tooltip'
import { TrackList } from './components/TrackList'
import { UpdateToast } from './components/UpdateToast'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useTrackProcessing } from './hooks/useTrackProcessing'
import { canAddToAppleMusic } from './lib/appleMusic'
import {
  autoMatchRelease,
  type DiscogsApi,
  matchTargetOf,
  tracksToAutoMatch,
} from './lib/autoMatch'
import { canProcessTrack, eligibleForBatch } from './lib/batch'
import { type Command, runCommand } from './lib/commands'
import { useLicense } from './lib/useLicense'
import { mapWithConcurrency } from './lib/concurrency'
import { smartDeriveTags } from './lib/deriveTags'
import { openFeedback } from './lib/feedback'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS } from './lib/fields'
import { parseFileName } from './lib/filename'
import { createFocusGate } from './lib/focusGate'
import { moveIndex } from './lib/keymap'
import { shouldShowOnboarding } from './lib/onboarding'
import { renderOutputName } from './lib/outputName'
import { needsDiscogsPrefetch } from './lib/prefetch'
import { applyProgress } from './lib/progress'
import { buildReleaseMeta } from './lib/release'
import { contentDeficit } from './lib/resize'
import { pageScrollTop } from './lib/scroll'
import { searchFromTags } from './lib/search'
import { type ClickMods, clickSelect, deselect, type Selection } from './lib/selection'
import { formatShortcut } from './lib/shortcuts'
import { resolveTheme } from './lib/theme'
import { filterByQuality, type QualityFilter, qualityCounts, tracksToAnalyze } from './lib/triage'
import type { TrackItem } from './types'

const AUDIO_EXT = /\.(wav|flac|aif|aiff|mp3|m4a|mp4|aac|ogg|oga|opus)$/i

// Cap on tracks read in parallel when files are dropped: each spawns taglib +
// ffprobe, so an unbounded drop of a full crate would flood the main process.
const READ_CONCURRENCY = 6

// Hovering counts as intent only after the cursor rests briefly, so sweeping the
// pointer across the list while scrolling doesn't fire a prefetch for every row.
const PREFETCH_HOVER_MS = 150

// Auto-match fires a Discogs search plus release loads per track, so the sweep stays
// at two in flight: Discogs' ~60 req/min is shared across the whole crate, and a
// wider fan-out would burn the quota (and risk 429s) faster than it helps.
const AUTO_MATCH_CONCURRENCY = 2

// Warms the main-process Discogs caches for a hovered track: the search the editor
// runs on open, plus the top release behind it. Both are cached by the main
// process, so opening the track (and clicking that release) then hits no network.
async function warmDiscogs(query: string): Promise<void> {
  // Background warming yields to the editor's own search, so it acquires at low priority.
  const results = await window.api.searchDiscogs(query, undefined, 'low')
  if (results[0]) await window.api.getRelease(results[0].id, undefined, 'low')
}

// macOS shows ⌘; everywhere else the shortcuts fire on Ctrl and read as "Ctrl".
const isMac = window.api.platform === 'darwin'

function newTrack(path: string): TrackItem {
  const { fileName, artist, title, query } = parseFileName(path)
  return {
    id: crypto.randomUUID(),
    inputPath: path,
    fileName,
    query,
    status: 'idle',
    listLabel: title || fileName,
    meta: {
      title,
      artist,
      album: '',
      albumArtist: artist,
      year: '',
      genre: '',
      grouping: '',
      comment: '',
      trackNumber: '',
      discNumber: '',
      bpm: '',
      key: '',
      publisher: '',
      catalogNumber: '',
      remixArtist: '',
    },
  }
}

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
  | { type: 'help' }
  | { type: 'findReplace' }
  | { type: 'rename' }
  | { type: 'export' }
  | { type: 'palette' }
  | { type: 'confirm'; confirm: ConfirmModal }
  | { type: 'upgrade'; reason: UpgradeReason }
  | null

export default function App(): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  // Freemium entitlement. `isPro` defaults to true until the snapshot loads (and is
  // always true during the beta), so a brief load never blocks a conversion. The
  // upgrade screen opens with a reason; null means closed.
  const license = useLicense()
  const isPro = license.snapshot?.entitlement.isPro ?? true
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null })
  const selectedId = selection.anchor
  const selectedIds = selection.ids
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  // Opens the freemium upgrade screen with the reason the wall appeared.
  const openUpgrade = (reason: UpgradeReason): void => setActiveModal({ type: 'upgrade', reason })
  // Live theme preview while the Settings modal is open; cleared when it closes.
  const [themePreview, setThemePreview] = useState<ThemePref | null>(null)
  // Quality triage view filter: narrows the list to suspect or unanalyzed tracks so a
  // big crate can be swept for fakes without scrolling past the clean ones.
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [dragging, setDragging] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // The scrolling track-list pane, handed to the rows as their IntersectionObserver root so
  // "on screen" means within this pane, not the whole window.
  const listScrollRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  // The floating player follows the selection: while it's open, picking another
  // track plays it. Space toggles its visibility; the X (or Space again) closes.
  const [playerVisible, setPlayerVisible] = useState(false)
  const [playingId, setPlayingId] = useState<string | null>(null)
  const playingIdRef = useRef<string | null>(null)
  playingIdRef.current = playingId
  // Refs so the prefetch callback can stay stable (memoized rows depend on it)
  // while still reading the latest tracks and spectrum setting on each hover.
  const tracksRef = useRef<TrackItem[]>([])
  tracksRef.current = tracks
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
  // Batch quality triage: progress of the "analyze quality" run (null when idle), and
  // a cancel flag the in-flight workers poll so cancelling stops new analyses without
  // killing the ones already handed to ffmpeg.
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null)
  const analyzeCancel = useRef(false)
  // Pauses the analyze-quality sweep while the window is in the background (fed by the
  // main process's blur/focus events) so it stops spawning ffmpeg until the app returns.
  const focusGate = useRef(createFocusGate())
  // Auto-match sweep: progress (null when idle), a cancel flag the workers poll, and a
  // ref guard so an import landing mid-sweep doesn't start a second concurrent run.
  const [matching, setMatching] = useState<{ done: number; total: number } | null>(null)
  const matchCancel = useRef(false)
  const matchingRef = useRef(false)
  // Track ids waiting for an auto-match, mapped to whether the row must be on screen before
  // it runs. An import enqueues its files visible-only so a 100-track drop probes Discogs for
  // the handful in view rather than the whole crate at once; the toolbar sweep enqueues
  // everything. The drain reads this together with which rows are currently visible.
  const matchQueue = useRef<Map<string, boolean>>(new Map())
  const visibleIds = useRef<Set<string>>(new Set())
  // Auto-match is background work: it probes Discogs at low priority so the editor's own search
  // (high priority) always jumps ahead, and the main process paces every Discogs call through one
  // shared per-minute bucket so a big crate can't earn 429s.
  const discogs = useMemo<DiscogsApi>(
    () => ({
      searchDiscogs: (q) => window.api.searchDiscogs(q, undefined, 'low'),
      getRelease: (id) => window.api.getRelease(id, undefined, 'low'),
    }),
    [],
  )
  // The format picked in the editor's split-button menu, so the keyboard convert
  // shortcuts export in it too. Null means "untouched" — fall back to the Settings
  // default. Reset on track switch, matching the editor reseeding per track.
  const editorFormatRef = useRef<OutputFormat | null>(null)
  // Per-track normalization override picked in the editor; null falls back to the
  // Settings default at conversion time, mirroring editorFormatRef.
  const editorNormalizeRef = useRef<NormalizeConfig | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setSettings(s)
      if (shouldShowOnboarding(s)) setActiveModal({ type: 'onboarding' })
    })
  }, [])

  // Conversions bump the persisted count from the main process, so re-read settings
  // each time the Settings modal opens to keep the Stats tab current within a session.
  const settingsOpen = activeModal?.type === 'settings'
  useEffect(() => {
    if (settingsOpen) {
      window.api.getSettings().then(setSettings)
      // Refresh the snapshot so the License tab and Stats usage meter are current.
      license.reload()
    }
  }, [settingsOpen, license.reload])

  useEffect(() => {
    const pref = themePreview ?? settings?.theme ?? 'system'
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      document.documentElement.dataset.theme = resolveTheme(pref, mq.matches)
    }
    apply()
    if (pref !== 'system') return
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [themePreview, settings?.theme])

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

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [],
  )

  useEffect(() => window.api.onWindowFocus((focused) => focusGate.current.set(focused)), [])

  async function addPaths(paths: string[]): Promise<void> {
    const existing = new Set(tracks.map((t) => t.inputPath))
    const fresh = paths.filter((p) => AUDIO_EXT.test(p) && !existing.has(p))
    if (fresh.length === 0) return
    // Show the rows the instant they're dropped, parsed from the file name, then fill in
    // tags, duration and cover as each file's read resolves. Reading metadata up front used
    // to block the whole drop behind the slowest file — on a cloud/network folder that's
    // seconds of an empty list that looks broken even though the import is running.
    const bases = fresh.map((path) => ({ ...newTrack(path), loadingMeta: true }))
    setTracks((prev) => [...prev, ...bases])
    setSelection((s) => (s.anchor ? s : { ids: [bases[0].id], anchor: bases[0].id }))
    void mapWithConcurrency(bases, READ_CONCURRENCY, async (base) => {
      const path = base.inputPath
      try {
        const [tags, duration, cover] = await Promise.all([
          window.api.readTags(path),
          window.api.readDuration(path),
          window.api.readCover(path),
        ])
        const s = searchFromTags(parseFileName(path), tags)
        const patch: Partial<TrackItem> = {
          query: s.query,
          duration: duration ?? undefined,
          coverUrl: cover ?? undefined,
          embeddedCover: cover ?? undefined,
          listLabel: s.title || base.fileName,
          meta: {
            ...base.meta,
            ...tags,
            title: s.title,
            artist: s.artist,
            albumArtist: tags.albumArtist || s.artist,
          },
          loadingMeta: false,
        }
        updateTrack(base.id, patch)
        // Opt-in: a fresh drop queues the Discogs auto-match for just these files, so the
        // crate tags itself as it lands. Queued visible-only, so a big folder probes the rows
        // in view as they scroll past rather than firing every file at the rate limit. Gated
        // on a token, and only once a file's own metadata is read so the search has a query.
        if (settings?.autoMatch && settings.discogsToken)
          enqueueAutoMatch([{ ...base, ...patch }], true)
      } catch {
        updateTrack(base.id, { loadingMeta: false })
      }
    })
  }

  // Files opened from Finder ("Open With Surco"), dropped on the dock, or double-clicked
  // reach us through the OS, not the renderer: the main process buffers any handed over
  // before this window existed and pushes later ones live. Drain the buffer on mount and
  // subscribe for the rest, routing both through the same expand+add path as a drop. The
  // ref keeps the live handler pointed at the latest addPaths so its dedupe sees the
  // current crate rather than the empty one captured at mount.
  const addPathsRef = useRef(addPaths)
  addPathsRef.current = addPaths
  useEffect(() => {
    const open = async (paths: string[]): Promise<void> => {
      if (paths.length) addPathsRef.current(await window.api.expandPaths(paths))
    }
    window.api.takePendingFiles().then(open)
    return window.api.onOpenFiles(open)
  }, [])

  const onSelectTrack = useCallback((id: string, mods: ClickMods): void => {
    const order = tracksRef.current.map((t) => t.id)
    setSelection((s) => clickSelect(s, order, id, mods))
  }, [])

  // Switching tracks drops a stale format pick so the next ⌘⏎ uses the Settings
  // default, mirroring the editor's per-track reseed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the deliberate trigger, not a value read in the body — the reset must fire on every track switch.
  useEffect(() => {
    editorFormatRef.current = null
    editorNormalizeRef.current = null
  }, [selectedId])

  async function pickFiles(): Promise<void> {
    addPaths(await window.api.pickFiles())
  }

  async function onDrop(e: React.DragEvent): Promise<void> {
    e.preventDefault()
    setDragging(false)
    const dropped = Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f))
    addPaths(await window.api.expandPaths(dropped))
  }

  const updateTrack = useCallback((id: string, patch: Partial<TrackItem>): void => {
    setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  // Writes a shared-field edit (or a dropped cover) onto every selected track at once —
  // the multi-select write path behind the editor's common-field form.
  const updateTracksMeta = useCallback((ids: string[], metaPatch: Partial<TrackMetadata>): void => {
    const targets = new Set(ids)
    setTracks((prev) =>
      prev.map((t) => (targets.has(t.id) ? { ...t, meta: { ...t.meta, ...metaPatch } } : t)),
    )
  }, [])

  const patchTracks = useCallback((ids: string[], patch: Partial<TrackItem>): void => {
    const targets = new Set(ids)
    setTracks((prev) => prev.map((t) => (targets.has(t.id) ? { ...t, ...patch } : t)))
  }, [])

  // Merges each track's own filename-derived tags into its metadata (one patch per id),
  // leaving fields the pattern didn't match untouched.
  const deriveTracks = useCallback(
    (patches: { id: string; meta: Partial<TrackMetadata> }[]): void => {
      const byId = new Map(patches.map((p) => [p.id, p.meta]))
      setTracks((prev) =>
        prev.map((t) => (byId.has(t.id) ? { ...t, meta: { ...t.meta, ...byId.get(t.id) } } : t)),
      )
    },
    [],
  )

  // Warms a hovered track's spectrum so opening it is instant. Debounced (the row only
  // counts as intent once the cursor rests). prefetchQuery skips a track already in the
  // cache and dedups concurrent hovers, so it needs no in-flight guard of its own.
  const handlePrefetch = useCallback(
    (id: string): void => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      hoverTimer.current = setTimeout(() => {
        const track = tracksRef.current.find((t) => t.id === id)
        if (!track) return
        if (showSpectrumRef.current) {
          void queryClient.prefetchQuery({
            queryKey: ['spectrogram', track.inputPath],
            queryFn: () => window.api.spectrogram(track.inputPath),
          })
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
    [queryClient],
  )

  // Analyzes every not-yet-measured track's spectrum at once so a whole dropped folder
  // is triaged for fake-lossless rips without opening each. Capped at 3 in flight (each
  // is an ffmpeg pass) and cancellable; fetchQuery fills the shared cache the list reads
  // its verdicts from, and dedups with a concurrent hover for the same file.
  const analyzeAllQuality = useCallback((): void => {
    const targets = tracksToAnalyze(tracksViewRef.current, new Set())
    if (analysis || targets.length === 0) return
    analyzeCancel.current = false
    let done = 0
    setAnalysis({ done: 0, total: targets.length })
    void mapWithConcurrency(targets, 3, async (t) => {
      if (analyzeCancel.current) return
      // Hold here while the window is in the background so the sweep doesn't spawn
      // ffmpeg off-screen; it resumes the moment the app is focused again.
      await focusGate.current.wait()
      if (analyzeCancel.current) return
      try {
        await queryClient.fetchQuery({
          queryKey: ['spectrogram', t.inputPath],
          queryFn: () => window.api.spectrogram(t.inputPath),
        })
      } catch {
        // A single file ffmpeg can't read must not abort the whole sweep.
      } finally {
        done += 1
        setAnalysis((a) => (a ? { ...a, done } : a))
      }
    }).finally(() => setAnalysis(null))
  }, [analysis, queryClient])

  // Probes Discogs for one track and applies a high-confidence release outright (the bar
  // autoMatchRelease enforces). Keeps the file's own cover — the release's is often smaller —
  // and only fills from the release when the file carries none, mirroring the editor's apply.
  const applyAutoMatch = useCallback(
    async (t: TrackItem): Promise<void> => {
      const m = await autoMatchRelease(t.query, matchTargetOf(t), discogs)
      if (!m || matchCancel.current) return
      const patch = buildReleaseMeta(t.meta, m.release, m.track, {
        url: t.coverUrl,
        path: t.coverPath,
        keep: !!t.coverUrl,
      })
      updateTrack(t.id, {
        meta: patch.meta,
        coverUrl: patch.coverUrl,
        coverPath: patch.coverPath,
        autoMatched: true,
      })
    },
    [discogs, updateTrack],
  )

  // The queued tracks ready to probe right now: a toolbar-enqueued track always, an
  // import-enqueued one only once its row is on screen. tracksToAutoMatch then drops any
  // already matched so a re-run only fills gaps.
  const readyMatchTargets = useCallback((): TrackItem[] => {
    const visible = visibleIds.current
    const ready = tracksRef.current.filter((t) => {
      const visibleOnly = matchQueue.current.get(t.id)
      return visibleOnly !== undefined && (!visibleOnly || visible.has(t.id))
    })
    return tracksToAutoMatch(ready)
  }, [])

  // Drains the auto-match queue against Discogs, capped and cancellable. Each pass takes the
  // tracks ready right now and probes them, so scrolling a big crate feeds the sweep the rows
  // the user is actually looking at instead of firing all hundred at import. Loops until
  // nothing's ready, then idles; a fresh drop or a row scrolling into view pumps it again. The
  // ref guard keeps a single drain running so rival pumps share one budget rather than racing.
  const pumpAutoMatch = useCallback(async (): Promise<void> => {
    if (matchingRef.current) return
    matchingRef.current = true
    matchCancel.current = false
    try {
      while (!matchCancel.current) {
        const targets = readyMatchTargets()
        if (targets.length === 0) break
        for (const t of targets) matchQueue.current.delete(t.id)
        setMatching((s) => ({ done: s?.done ?? 0, total: (s?.total ?? 0) + targets.length }))
        await mapWithConcurrency(targets, AUTO_MATCH_CONCURRENCY, async (t) => {
          if (!matchCancel.current) await applyAutoMatch(t)
          setMatching((s) => (s ? { ...s, done: s.done + 1 } : s))
        })
      }
    } finally {
      matchingRef.current = false
      setMatching(null)
      // A track enqueued in the instant the loop was exiting would otherwise strand until the
      // next pump; restart if anything's already ready (e.g. the toolbar "match all" click).
      if (!matchCancel.current && readyMatchTargets().length > 0) void pumpAutoMatch()
    }
  }, [applyAutoMatch, readyMatchTargets])

  // Queues tracks for auto-match and kicks the drain. visibleOnly holds an import's files back
  // until their rows are seen; the toolbar sweep passes false to match the whole view now.
  const enqueueAutoMatch = useCallback(
    (candidates: TrackItem[], visibleOnly: boolean): void => {
      for (const t of tracksToAutoMatch(candidates)) matchQueue.current.set(t.id, visibleOnly)
      void pumpAutoMatch()
    },
    [pumpAutoMatch],
  )

  // Records which rows are on screen (the list reports it via an IntersectionObserver) and
  // pumps the drain when one appears, so an import's auto-match follows the user's scroll.
  const onTrackVisible = useCallback(
    (id: string, visible: boolean): void => {
      if (visible) {
        visibleIds.current.add(id)
        void pumpAutoMatch()
      } else {
        visibleIds.current.delete(id)
      }
    },
    [pumpAutoMatch],
  )

  // Stable identity so the memoized TrackRow only re-renders the row that
  // changed. The functional update deselects iff the removed track was selected,
  // which is what the explicit selectedId check did before.
  const removeTrack = useCallback((id: string): void => {
    setTracks((prev) => prev.filter((t) => t.id !== id))
    setSelection((s) => deselect(s, id))
    // Drop the track's prefetch/view bookkeeping so they don't accumulate ids of
    // tracks that no longer exist across a long session of add/remove.
    discogsPrefetched.current.delete(id)
    viewCache.current.delete(id)
  }, [])

  function clearTracks(): void {
    setTracks([])
    setSelection({ ids: [], anchor: null })
    discogsPrefetched.current.clear()
    viewCache.current.clear()
    matchQueue.current.clear()
    visibleIds.current.clear()
  }

  // Right-click "Search Discogs": make the track active, then focus the search box on the
  // next tick once the editor for the new selection has mounted and bound the ref.
  const onSearchTrack = useCallback(
    (id: string): void => {
      onSelectTrack(id, {})
      setTimeout(() => searchInputRef.current?.focus(), 0)
    },
    [onSelectTrack],
  )

  // Right-click "Move to Trash": confirm first, then send the original file to the OS
  // Trash/Recycle Bin and drop the row only once that succeeds, so a failure leaves the
  // list untouched. Copy switches on platform because the destination differs.
  function askTrash(track: TrackItem): void {
    const isWin = window.api.platform === 'win32'
    askConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle'),
      message: tr(isWin ? 'confirm.trashMessageWin' : 'confirm.trashMessage', {
        name: track.fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
      destructive: true,
      onConfirm: () => {
        window.api
          .trashFile(track.inputPath)
          .then(() => removeTrack(track.id))
          .catch(() => {})
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
          .catch(() => {})
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

  const startPlayback = useCallback((track: TrackItem): void => {
    const audio = audioRef.current
    if (!audio) return
    // The custom surco:// scheme streams the file from the main process, so the
    // <audio> element seeks through it without buffering the whole track in memory.
    audio.src = mediaUrl(track.inputPath)
    audio.currentTime = 0
    setPlayingId(track.id)
    audio.play().catch(() => {})
  }, [])

  const closePlayer = useCallback((): void => {
    const audio = audioRef.current
    audio?.pause()
    audio?.removeAttribute('src')
    setPlayerVisible(false)
    setPlayingId(null)
  }, [])

  // Removing (or clearing) the track that is playing must stop the audio: the
  // file it streamed is gone from the list, so the player would otherwise keep
  // sounding it while the card shows a different, still-selected track.
  useEffect(() => {
    if (playingId && !tracks.some((t) => t.id === playingId)) closePlayer()
  }, [tracks, playingId, closePlayer])

  // Space toggles the player's visibility; the selection effect below starts
  // playback when it opens.
  function togglePlay(): void {
    if (playerVisible) closePlayer()
    else if (selected) setPlayerVisible(true)
  }

  // While the player is open, opening it or selecting another track plays that
  // track. Guarded against re-playing the one already loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedId is the trigger; `selected` is read fresh, and depending on it would re-fire every render.
  useEffect(() => {
    if (playerVisible && selected && selected.id !== playingIdRef.current) startPlayback(selected)
  }, [selectedId, playerVisible, startPlayback])

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
    isPro,
    onUpgrade: openUpgrade,
    onLicenseChanged: license.reload,
  })

  function saveSettings(patch: Partial<Settings>): void {
    // Apply the theme optimistically so clearing the live preview on close
    // doesn't flash the old theme while the persisted value round-trips.
    if (patch.theme !== undefined) {
      setSettings((s) => (s ? { ...s, theme: patch.theme as ThemePref } : s))
    }
    window.api.saveSettings(patch).then(setSettings)
  }

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
    const next = moveIndex(
      tracks.length,
      tracks.findIndex((t) => t.id === selectedId),
      delta,
    )
    if (next === -1) return
    setSelection({ ids: [tracks[next].id], anchor: tracks[next].id })
    // Move DOM focus with the selection so the native focus ring follows the
    // keyboard instead of staying on the last clicked row, which left two rows
    // looking highlighted at once. preventScroll: we page the list ourselves below
    // rather than let the browser nudge the row flush to the margin.
    const row = document.querySelectorAll<HTMLButtonElement>('[data-testid="track-row"]')[next]
    if (!row) return
    row.focus({ preventScroll: true })
    const container = listScrollRef.current
    if (!container) return
    const cRect = container.getBoundingClientRect()
    const rRect = row.getBoundingClientRect()
    const header = container.querySelector<HTMLElement>('[data-testid="quality-filter"]')
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

  const sidebar = useResizableWidth(300, 300, 600)

  // Double-clicking the divider fits the list to its tracks: measure how far each title and
  // artist is clipped (or has to spare) and resize by the widest, so long names stop
  // truncating without the user dragging — and an over-wide column tightens back up.
  const autoFitSidebar = useCallback((): void => {
    const spans = document.querySelectorAll<HTMLElement>('[data-testid="track-row"] [data-fit]')
    const rows = Array.from(spans, (s) => ({
      scrollWidth: s.scrollWidth,
      clientWidth: s.clientWidth,
    }))
    sidebar.autoFit(contentDeficit(rows))
  }, [sidebar.autoFit])

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  const selectedTracks = useMemo(
    () => tracks.filter((t) => selectedIds.includes(t.id)),
    [tracks, selectedIds],
  )
  // Falls back to the selection so the card still renders for the brief moment
  // between opening and the first track loading.
  const playerTrack = tracks.find((t) => t.id === playingId) ?? selected

  const canProcessSelected =
    !!selected && canProcessTrack(selected, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  const eligibleCount = useMemo(() => eligibleForBatch(tracks).length, [tracks])
  const selectedEligibleCount = useMemo(
    () => eligibleForBatch(selectedTracks).length,
    [selectedTracks],
  )

  // Each track's spectrum, read from the shared React Query cache the hover prefetch,
  // the analyze sweep and the editor all fill. enabled:false so the list only observes —
  // it never triggers an analysis itself.
  const spectrumQueries = useQueries({
    queries: tracks.map((t) => ({
      queryKey: ['spectrogram', t.inputPath],
      queryFn: () => window.api.spectrogram(t.inputPath),
      enabled: false,
    })),
  })
  // Merge each cached spectrum onto its track for the quality triage and the list,
  // preserving object identity (via viewCache) so memoized rows don't all re-render.
  // Memoized so a progress tick during an analyze/convert/match sweep doesn't rebuild
  // the whole list (and re-run the quality/auto-match scans below) on every re-render.
  const tracksView = useMemo(
    () =>
      tracks.map((t, i) => {
        const spectrum = spectrumQueries[i]?.data
        if (!spectrum) return t
        const cached = viewCache.current.get(t.id)
        if (cached && cached.track === t && cached.spectrum === spectrum) return cached.view
        const view: TrackItem = { ...t, spectrum }
        viewCache.current.set(t.id, { track: t, spectrum, view })
        return view
      }),
    [tracks, spectrumQueries],
  )
  tracksViewRef.current = tracksView

  const qualityTally = useMemo(() => qualityCounts(tracksView), [tracksView])
  const visibleTracks = useMemo(
    () => filterByQuality(tracksView, qualityFilter),
    [tracksView, qualityFilter],
  )
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

  const commands: Command[] = [
    {
      id: 'add',
      title: tr('commands.add'),
      hint: hintFor('add'),
      enabled: true,
      run: pickFiles,
    },
    {
      id: 'find-replace',
      title: tr('commands.findReplace'),
      hint: hintFor('find-replace'),
      enabled: tracks.length > 0,
      run: () => setActiveModal({ type: 'findReplace' }),
    },
    {
      id: 'select-all',
      title: tr('commands.selectAll'),
      hint: hintFor('select-all'),
      enabled: tracks.length > 0,
      run: selectAll,
    },
    {
      id: 'fill-all',
      title: tr('commands.fillAll'),
      hint: hintFor('fill-all'),
      enabled: tracks.length > 0,
      run: askFillAll,
    },
    {
      id: 'prev',
      title: tr('commands.prev'),
      hint: hintFor('prev'),
      enabled: tracks.length > 1,
      run: () => moveSelection(-1),
    },
    {
      id: 'next',
      title: tr('commands.next'),
      hint: hintFor('next'),
      enabled: tracks.length > 1,
      run: () => moveSelection(1),
    },
    {
      id: 'play',
      title: tr('commands.play'),
      hint: hintFor('play'),
      enabled: !!selected,
      run: togglePlay,
    },
    {
      id: 'search',
      title: tr('commands.search'),
      hint: hintFor('search'),
      enabled: !!selected,
      run: () => searchInputRef.current?.focus(),
    },
    {
      id: 'process-current',
      title: tr('commands.processCurrent'),
      hint: hintFor('process-current'),
      enabled: canProcessSelected,
      run: () =>
        selected &&
        processOne(
          selected.id,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        ),
    },
    {
      id: 'process-all',
      title: tr('commands.processAll'),
      hint: hintFor('process-all'),
      enabled: canProcessAll,
      run: () =>
        processAll(
          tracks,
          editorFormatRef.current ?? undefined,
          editorNormalizeRef.current ?? undefined,
        ),
    },
    {
      // Toggles the quality sweep: starts it, or cancels a running one — the same button
      // the toolbar shows. Disabled once every loaded track is already analyzed.
      id: 'analyze-quality',
      title: tr('commands.analyzeQuality'),
      hint: hintFor('analyze-quality'),
      enabled: analysis ? true : !tracksView.every((t) => Boolean(t.spectrum)),
      run: () => {
        if (analysis) analyzeCancel.current = true
        else analyzeAllQuality()
      },
    },
    {
      // Toggles the Discogs auto-match sweep. Needs a user token and at least one
      // unmatched track, mirroring the toolbar button's disabled rule.
      id: 'auto-match',
      title: tr('commands.autoMatch'),
      hint: hintFor('auto-match'),
      enabled: matching ? true : !!settings?.discogsToken && autoMatchable > 0,
      run: () => {
        if (matching) matchCancel.current = true
        else enqueueAutoMatch(tracksView, false)
      },
    },
    {
      // Pro feature: opens the DJ-software export when licensed, otherwise the upgrade
      // prompt — the same gate the toolbar applies.
      id: 'export',
      title: tr('commands.export'),
      hint: hintFor('export'),
      enabled: tracks.length > 0,
      run: () => (isPro ? setActiveModal({ type: 'export' }) : openUpgrade('export')),
    },
    {
      id: 'upgrade',
      title: tr('commands.upgrade'),
      hint: hintFor('upgrade'),
      enabled: true,
      run: () => openUpgrade('manage'),
    },
    {
      id: 'reveal',
      title: tr('commands.reveal'),
      hint: hintFor('reveal'),
      enabled: !!selected?.outputPath,
      run: () => selected?.outputPath && window.api.reveal(selected.outputPath),
    },
    {
      // Builds the output name from a pattern. Only one track has a File name section
      // (multi-select hides it), so the command follows the same single-track rule.
      // Overwrite mode pins the name to the original, so renaming is disabled there too.
      id: 'rename',
      title: tr('commands.rename'),
      hint: hintFor('rename'),
      enabled: !!selected && selectedTracks.length <= 1 && !settings?.overwriteOriginal,
      run: () => setActiveModal({ type: 'rename' }),
    },
    {
      id: 'add-apple-music',
      title: tr('commands.addAppleMusic'),
      hint: hintFor('add-apple-music'),
      enabled:
        !!selected &&
        canAddToAppleMusic(selected, window.api.platform, settings?.outputFormat ?? 'aiff'),
      run: () => selected && addTrackToAppleMusic(selected.id),
    },
    {
      id: 'remove',
      title: tr('commands.remove'),
      hint: hintFor('remove'),
      enabled: !!selected,
      run: () => selected && removeTrack(selected.id),
    },
    {
      id: 'remove-all',
      title: tr('commands.removeAll'),
      enabled: tracks.length > 0,
      run: clearTracks,
    },
    {
      id: 'settings',
      title: tr('commands.settings'),
      hint: hintFor('settings'),
      enabled: true,
      run: () => openSettings(),
    },
    {
      id: 'shortcuts',
      title: tr('commands.shortcuts'),
      hint: hintFor('shortcuts'),
      enabled: true,
      run: () => openSettings('shortcuts'),
    },
    {
      id: 'stats',
      title: tr('commands.stats'),
      hint: hintFor('stats'),
      enabled: true,
      run: () => openSettings('stats'),
    },
    {
      id: 'help',
      title: tr('commands.help'),
      enabled: true,
      run: () => setActiveModal({ type: 'help' }),
    },
    {
      id: 'feedback',
      title: tr('commands.feedback'),
      enabled: true,
      run: () => openFeedback(),
    },
    {
      id: 'website',
      title: tr('commands.website'),
      enabled: true,
      run: () => window.open('https://getsurco.app/'),
    },
  ]

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
      <audio ref={audioRef} hidden onEnded={closePlayer} />
      {/* Names the window for screen readers; visually redundant with the title bar. */}
      <h1 className="sr-only">Surco</h1>
      <Toolbar
        isMac={isMac}
        trackCount={tracks.length}
        batchSummary={batchSummary}
        batching={batching}
        batchProgress={batchProgress}
        analysis={analysis}
        allAnalyzed={tracksView.every((t) => Boolean(t.spectrum))}
        matching={matching}
        hasToken={!!settings?.discogsToken}
        autoMatchable={autoMatchable}
        selectedEligibleCount={selectedEligibleCount}
        onAdd={pickFiles}
        onSelectAll={selectAll}
        onFillAll={askFillAll}
        onFindReplace={() => setActiveModal({ type: 'findReplace' })}
        onAnalyzeAll={analyzeAllQuality}
        onCancelAnalyze={() => {
          analyzeCancel.current = true
        }}
        onAutoMatch={() => enqueueAutoMatch(tracksView, false)}
        onCancelAutoMatch={() => {
          matchCancel.current = true
        }}
        onConvertSelected={() => processAll(selectedTracks)}
        onCancelConvert={cancelBatch}
        onExport={() => (isPro ? setActiveModal({ type: 'export' }) : openUpgrade('export'))}
        onClearAll={askClearAll}
        onPalette={() => setActiveModal({ type: 'palette' })}
        onStats={() => openSettings('stats')}
        onSettings={() => openSettings()}
      />

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
                <div
                  data-testid="quality-filter"
                  className="sticky top-0 z-10 flex gap-0.5 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-1.5 py-2"
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
                </div>
                <TrackList
                  tracks={visibleTracks}
                  selectedId={selectedId}
                  selectedIds={selectedIds}
                  outputFormat={settings?.outputFormat ?? 'aiff'}
                  onSelect={onSelectTrack}
                  onRemove={removeTrack}
                  onPrefetch={handlePrefetch}
                  onSearch={onSearchTrack}
                  onTrash={askTrash}
                  scrollRootRef={listScrollRef}
                  onVisible={onTrackVisible}
                />
              </>
            )}
          </div>
          {playerVisible && playerTrack && (
            <LivePlayer track={playerTrack} audioRef={audioRef} onClose={closePlayer} />
          )}
        </aside>

        <ResizeHandle
          onPointerDown={sidebar.onPointerDown}
          onDoubleClick={autoFitSidebar}
          title={tr('sidebar.fitHint')}
        />

        <main className="min-w-0 flex-1 bg-[var(--color-panel)]">
          {selected ? (
            <Editor
              key={selected.id}
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
              normalize={
                settings?.normalize ?? { mode: 'none', targetLufs: -14, truePeakDb: -1, peakDb: -1 }
              }
              searchInputRef={searchInputRef}
              selectedTracks={selectedTracks}
              onApplyMatches={(patches) => {
                for (const p of patches) updateTrack(p.id, p.patch)
              }}
              onProcessAll={(format) =>
                processAll(selectedTracks, format, editorNormalizeRef.current ?? undefined)
              }
              onAddAllToAppleMusic={() => addAllToAppleMusic(selectedIds)}
              onChangeAllMeta={(patch) => updateTracksMeta(selectedIds, patch)}
              onApplyCoverAll={(coverUrl, coverPath) =>
                patchTracks(selectedIds, { coverUrl, coverPath })
              }
              onDeriveTags={deriveTracks}
              onChange={(patch) => updateTrack(selected.id, patch)}
              onProcess={(format) =>
                processOne(selected.id, format, editorNormalizeRef.current ?? undefined)
              }
              onFormatChange={(format) => {
                editorFormatRef.current = format
              }}
              onNormalizeChange={(n) => {
                editorNormalizeRef.current = n
              }}
              onAddToAppleMusic={() => addTrackToAppleMusic(selected.id)}
              onTrashOriginal={() => askDeleteOriginal(selected)}
              onOpenSettings={openSettings}
              onOpenRename={() => setActiveModal({ type: 'rename' })}
              onRegenerateName={() => {
                const name = renderOutputName(
                  settings?.filenameFormat ?? '{artist} - {title}',
                  selected.meta,
                )
                if (name) updateTrack(selected.id, { outputName: name })
              }}
            />
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

      {activeModal?.type === 'settings' && settings && (
        <SettingsModal
          settings={settings}
          onClose={closeSettings}
          onSave={saveSettings}
          onPreviewTheme={setThemePreview}
          initialTab={activeModal.tab}
          license={license.snapshot}
          onLicenseChanged={license.reload}
        />
      )}

      {activeModal?.type === 'onboarding' && settings && (
        <OnboardingWizard settings={settings} onFinish={finishOnboarding} />
      )}

      {activeModal?.type === 'help' && <HelpModal onClose={() => setActiveModal(null)} />}
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
      {activeModal?.type === 'upgrade' && license.snapshot && (
        <UpgradeModal
          snapshot={license.snapshot}
          reason={activeModal.reason}
          onClose={() => setActiveModal(null)}
          onChanged={license.reload}
        />
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

      <UpdateToast />
    </div>
  )
}
