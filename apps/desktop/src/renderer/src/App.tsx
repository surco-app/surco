import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../shared/media'
import { resolveBindings } from '../../shared/shortcutDefaults'
import type {
  NormalizeConfig,
  OutputFormat,
  Settings,
  ThemePref,
  TrackMetadata,
} from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { FindReplaceModal } from './components/FindReplaceModal'
import { HelpModal } from './components/HelpModal'
import { OnboardingWizard } from './components/OnboardingWizard'
import { LivePlayer } from './components/Player'
import { RenameModal } from './components/RenameModal'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
import { Tooltip } from './components/Tooltip'
import { TrackList } from './components/TrackList'
import { UpdateToast } from './components/UpdateToast'
import { canAddToAppleMusic } from './lib/appleMusic'
import {
  type BatchOutcome,
  type BatchSummary,
  canProcessTrack,
  eligibleForBatch,
  summarizeBatch,
} from './lib/batch'
import { type Command, runCommand } from './lib/commands'
import { mapWithConcurrency } from './lib/concurrency'
import { smartDeriveTags } from './lib/deriveTags'
import { exportedPatch } from './lib/export'
import { openFeedback } from './lib/feedback'
import { DEFAULT_FIELDS, DEFAULT_REQUIRED_FIELDS, missingRequired } from './lib/fields'
import { parseFileName } from './lib/filename'
import { sanitizeMeta } from './lib/hygiene'
import { isTypingTarget, keyToCommandId, moveIndex } from './lib/keymap'
import { shouldShowOnboarding } from './lib/onboarding'
import { needsDiscogsPrefetch, needsSpectrum } from './lib/prefetch'
import { applyProgress } from './lib/progress'
import { buildRekordboxXml } from './lib/rekordbox'
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

// Warms the main-process Discogs caches for a hovered track: the search the editor
// runs on open, plus the top release behind it. Both are cached by the main
// process, so opening the track (and clicking that release) then hits no network.
async function warmDiscogs(query: string): Promise<void> {
  const results = await window.api.searchDiscogs(query)
  if (results[0]) await window.api.getRelease(results[0].id)
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

// The glyph for each list filter chip. Drawn inside a shared 24×24 stroked <svg> so the
// icons stay visually consistent with the rest of the toolbar.
function filterIcon(mode: QualityFilter): React.JSX.Element {
  switch (mode) {
    case 'suspect':
      return (
        <>
          <path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </>
      )
    case 'good':
      return (
        <>
          <circle cx="12" cy="12" r="10" />
          <path d="m9 12 2 2 4-4" />
        </>
      )
    case 'unanalyzed':
      return (
        <path d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2" />
      )
    case 'unconverted':
      return (
        <>
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M3 21v-5h5" />
        </>
      )
    default:
      return (
        <>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </>
      )
  }
}

export default function App(): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null })
  const selectedId = selection.anchor
  const selectedIds = selection.ids
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'general' | 'stats' | 'naming' | 'shortcuts'>(
    'general',
  )
  const [themePreview, setThemePreview] = useState<ThemePref | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showFindReplace, setShowFindReplace] = useState(false)
  const [showRename, setShowRename] = useState(false)
  // Quality triage view filter: narrows the list to suspect or unanalyzed tracks so a
  // big crate can be swept for fakes without scrolling past the clean ones.
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [confirm, setConfirm] = useState<{
    title: string
    message: string
    confirmLabel: string
    confirmDisabled?: boolean
    onConfirm: () => void
  } | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [dragging, setDragging] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
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
  const spectrumInFlight = useRef<Set<string>>(new Set())
  // Marks tracks whose Discogs caches are warmed (or warming) so a second hover
  // never re-runs the search; cleared on failure so a transient error can retry.
  const discogsPrefetched = useRef<Set<string>>(new Set())
  const [batching, setBatching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  // Batch quality triage: progress of the "analyze quality" run (null when idle), and
  // a cancel flag the in-flight workers poll so cancelling stops new analyses without
  // killing the ones already handed to ffmpeg.
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null)
  const analyzeCancel = useRef(false)
  // Set by the Cancel button to break the convert-all loop between tracks.
  const cancelBatchRef = useRef(false)
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
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
      if (shouldShowOnboarding(s)) setShowOnboarding(true)
    })
  }, [])

  // Conversions bump the persisted count from the main process, so re-read settings
  // each time the modal opens to keep the Stats tab current within a session.
  useEffect(() => {
    if (showSettings) window.api.getSettings().then(setSettings)
  }, [showSettings])

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
        if (id === 'palette') setShowPalette(true)
        else runCommand(commandsRef.current, id)
      }),
    [],
  )

  useEffect(
    () => window.api.onProcessProgress((p) => setTracks((prev) => applyProgress(prev, p))),
    [],
  )

  // The batch summary is a transient confirmation, not a persistent banner — it
  // clears itself a few seconds after a run so it never lingers over later work.
  useEffect(() => {
    if (!batchSummary) return
    const id = setTimeout(() => setBatchSummary(null), 6000)
    return () => clearTimeout(id)
  }, [batchSummary])

  async function addPaths(paths: string[]): Promise<void> {
    const existing = new Set(tracks.map((t) => t.inputPath))
    const fresh = paths.filter((p) => AUDIO_EXT.test(p) && !existing.has(p))
    if (fresh.length === 0) return
    const items = await mapWithConcurrency(fresh, READ_CONCURRENCY, async (path) => {
      const base = newTrack(path)
      try {
        const [tags, duration, cover] = await Promise.all([
          window.api.readTags(path),
          window.api.readDuration(path),
          window.api.readCover(path),
        ])
        const s = searchFromTags(parseFileName(path), tags)
        return {
          ...base,
          query: s.query,
          duration: duration ?? undefined,
          coverUrl: cover ?? undefined,
          meta: {
            ...base.meta,
            ...tags,
            title: s.title,
            artist: s.artist,
            albumArtist: tags.albumArtist || s.artist,
          },
        }
      } catch {
        return base
      }
    })
    setTracks((prev) => [...prev, ...items])
    setSelection((s) => (s.anchor ? s : { ids: [items[0].id], anchor: items[0].id }))
  }

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

  // Warms a hovered track's spectrum so opening it is instant. Debounced (the row
  // only counts as intent once the cursor rests) and guarded by an in-flight set
  // so a second hover never spawns a duplicate ffmpeg run for the same track.
  const handlePrefetch = useCallback(
    (id: string): void => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
      hoverTimer.current = setTimeout(() => {
        const track = tracksRef.current.find((t) => t.id === id)
        if (!track) return
        if (needsSpectrum(track, showSpectrumRef.current) && !spectrumInFlight.current.has(id)) {
          spectrumInFlight.current.add(id)
          window.api
            .spectrogram(track.inputPath)
            .then((spectrum) => updateTrack(id, { spectrum }))
            .catch(() => {})
            .finally(() => spectrumInFlight.current.delete(id))
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
    [updateTrack],
  )

  // Analyzes every not-yet-measured track's spectrum at once so a whole dropped
  // folder is triaged for fake-lossless rips without opening each. Capped at 3 in
  // flight (each is an ffmpeg pass) and cancellable; reuses the hover prefetch's
  // in-flight guard so a concurrent hover never double-spawns the same track. The
  // shared spectrogram result also warms the editor for when the track is opened.
  const analyzeAllQuality = useCallback((): void => {
    const targets = tracksToAnalyze(tracksRef.current, spectrumInFlight.current)
    if (analysis || targets.length === 0) return
    analyzeCancel.current = false
    let done = 0
    setAnalysis({ done: 0, total: targets.length })
    void mapWithConcurrency(targets, 3, async (t) => {
      if (analyzeCancel.current) return
      spectrumInFlight.current.add(t.id)
      try {
        const spectrum = await window.api.spectrogram(t.inputPath)
        updateTrack(t.id, { spectrum })
      } catch {
        // A single file ffmpeg can't read must not abort the whole sweep.
      } finally {
        spectrumInFlight.current.delete(t.id)
        done += 1
        setAnalysis((a) => (a ? { ...a, done } : a))
      }
    }).finally(() => setAnalysis(null))
  }, [analysis, updateTrack])

  // Stable identity so the memoized TrackRow only re-renders the row that
  // changed. The functional update deselects iff the removed track was selected,
  // which is what the explicit selectedId check did before.
  const removeTrack = useCallback((id: string): void => {
    setTracks((prev) => prev.filter((t) => t.id !== id))
    setSelection((s) => deselect(s, id))
    // Drop the track's prefetch bookkeeping so the sets don't accumulate ids of
    // tracks that no longer exist across a long session of add/remove.
    spectrumInFlight.current.delete(id)
    discogsPrefetched.current.delete(id)
  }, [])

  function clearTracks(): void {
    setTracks([])
    setSelection({ ids: [], anchor: null })
    spectrumInFlight.current.clear()
    discogsPrefetched.current.clear()
  }

  // Writes the loaded crate to a rekordbox collection XML the user can import. The
  // native save dialog is the confirmation, so there's nothing more to show after.
  function exportRekordbox(): void {
    if (tracksRef.current.length === 0) return
    void window.api.exportRekordbox(buildRekordboxXml(tracksRef.current))
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
    setConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle'),
      message: tr(isWin ? 'confirm.trashMessageWin' : 'confirm.trashMessage', {
        name: track.fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
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
    setConfirm({
      title: tr(isWin ? 'confirm.trashTitleWin' : 'confirm.trashTitle'),
      message: tr(isWin ? 'confirm.deleteOriginalMessageWin' : 'confirm.deleteOriginalMessage', {
        name: track.fileName,
      }),
      confirmLabel: tr(isWin ? 'confirm.trashConfirmWin' : 'confirm.trashConfirm'),
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
    setConfirm({
      title: tr('confirm.fillTitle'),
      message: count > 0 ? tr('confirm.fillMessage', { count }) : tr('confirm.fillNone'),
      confirmLabel: tr('confirm.fillConfirm'),
      confirmDisabled: count === 0,
      onConfirm: deriveAll,
    })
  }

  function askClearAll(): void {
    setConfirm({
      title: tr('confirm.clearTitle'),
      message: tr('confirm.clearMessage', { count: tracks.length }),
      confirmLabel: tr('confirm.clearConfirm'),
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

  async function processOne(
    id: string,
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ): Promise<BatchOutcome> {
    const track = tracks.find((t) => t.id === id)
    if (!track) return 'failed'
    const missing = missingRequired(track.meta, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
    if (missing.length) {
      const names = missing.map((k) => tr(`fields.${k}`)).join(', ')
      updateTrack(id, {
        status: 'error',
        error: tr('editor.missingRequired', { fields: names }),
        stage: undefined,
      })
      return 'failed'
    }
    // Re-processing an edited (stale) track resets the Apple Music state too, since
    // the file it referred to is being rewritten — the user may want to add it again.
    updateTrack(id, {
      status: 'processing',
      error: undefined,
      stage: undefined,
      format: formatOverride ?? settings?.outputFormat ?? 'aiff',
      musicStatus: undefined,
      musicError: undefined,
    })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    // Default to the source file's own name: users expect "load and convert" to keep
    // their filename. A metadata-derived name is only used when the editor's
    // "Regenerate from metadata" button (or a manual edit) set track.outputName.
    const outputName = track.outputName?.trim() || track.fileName
    try {
      const result = await window.api.processTrack({
        id: track.id,
        inputPath: track.inputPath,
        outputName,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
        removeCover: track.coverRemoved,
        format: formatOverride,
        normalize: normalizeOverride,
        previousOutputPath: track.outputPath,
      })
      // The user declined to overwrite a conflicting file: nothing was written, so
      // leave the track convertible (idle) rather than marking it done or failed.
      if (result.skipped) {
        updateTrack(id, { status: 'idle', stage: undefined })
        return 'skipped'
      }
      updateTrack(id, exportedPatch(track, result))
      return 'converted'
    } catch (e) {
      updateTrack(id, {
        status: 'error',
        error: e instanceof Error ? e.message : tr('editor.processError'),
        stage: undefined,
      })
      return 'failed'
    }
  }

  // Pushes an already-converted track into Apple Music by hand, the escape hatch
  // for when the automatic add is off. The meta is sanitized exactly as the
  // conversion does so the library entry matches the file; musicStatus drives the
  // button's adding/added/error states without disturbing the track's own status.
  async function addTrackToAppleMusic(id: string): Promise<void> {
    const track = tracks.find((t) => t.id === id)
    if (!track?.outputPath || track.musicStatus === 'adding') return
    updateTrack(id, { musicStatus: 'adding', musicError: undefined })
    const meta = sanitizeMeta(track.meta, {
      trim: settings?.trimWhitespace ?? true,
      zeroPad: settings?.zeroPadTrack ?? true,
    })
    try {
      await window.api.addToAppleMusic({
        outputPath: track.outputPath,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
      })
      updateTrack(id, { musicStatus: 'added' })
    } catch (e) {
      updateTrack(id, {
        musicStatus: 'error',
        musicError: e instanceof Error ? e.message : tr('editor.appleMusicError'),
      })
    }
  }

  // Adds every selected track to Apple Music in turn — the multi-select counterpart of
  // the per-track button, reusing the same single-track add (which skips ones not yet
  // converted) so the two paths can never drift.
  async function addAllToAppleMusic(ids: string[]): Promise<void> {
    for (const id of ids) await addTrackToAppleMusic(id)
  }

  async function processAll(
    formatOverride?: OutputFormat,
    normalizeOverride?: NormalizeConfig,
  ): Promise<void> {
    if (batching) return
    const ids = eligibleForBatch(tracks)
    cancelBatchRef.current = false
    setBatching(true)
    setBatchSummary(null)
    setBatchProgress({ done: 0, total: ids.length })
    const results: BatchOutcome[] = []
    try {
      for (const id of ids) {
        // Cancel stops the loop before the next track; the one already converting
        // in the main process can't be aborted, so it finishes and is counted.
        if (cancelBatchRef.current) break
        results.push(await processOne(id, formatOverride, normalizeOverride))
        setBatchProgress({ done: results.length, total: ids.length })
      }
    } finally {
      setBatching(false)
      setBatchSummary(summarizeBatch(results))
    }
  }

  function saveSettings(patch: Partial<Settings>): void {
    // Apply the theme optimistically so clearing the live preview on close
    // doesn't flash the old theme while the persisted value round-trips.
    if (patch.theme !== undefined) {
      setSettings((s) => (s ? { ...s, theme: patch.theme as ThemePref } : s))
    }
    window.api.saveSettings(patch).then(setSettings)
  }

  function openSettings(tab: 'general' | 'stats' | 'naming' | 'shortcuts' = 'general'): void {
    setSettingsTab(tab)
    setShowSettings(true)
  }

  function closeSettings(): void {
    setShowSettings(false)
    setThemePreview(null)
  }

  function finishOnboarding(patch: Partial<Settings>): void {
    saveSettings(patch)
    setShowOnboarding(false)
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
    // looking highlighted at once.
    document.querySelectorAll<HTMLButtonElement>('[data-testid="track-row"]')[next]?.focus()
  }

  const sidebar = useResizableWidth(260, 220, 520)

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  const selectedTracks = tracks.filter((t) => selectedIds.includes(t.id))
  // Falls back to the selection so the card still renders for the brief moment
  // between opening and the first track loading.
  const playerTrack = tracks.find((t) => t.id === playingId) ?? selected

  const canProcessSelected =
    !!selected && canProcessTrack(selected, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  const eligibleCount = eligibleForBatch(tracks).length

  const qualityTally = qualityCounts(tracks)
  const visibleTracks = filterByQuality(tracks, qualityFilter)
  const canProcessAll = eligibleCount > 0 && !batching

  // Effective key bindings (defaults + the user's overrides): the single source the
  // palette hints below and the keydown listener (via a ref, since it subscribes once)
  // both read, so a rebind in Settings updates everywhere at once.
  const bindings = useMemo(
    () => resolveBindings(settings?.shortcutOverrides),
    [settings?.shortcutOverrides],
  )
  const bindingsRef = useRef(bindings)
  bindingsRef.current = bindings
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
      run: () => setShowFindReplace(true),
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
        processAll(editorFormatRef.current ?? undefined, editorNormalizeRef.current ?? undefined),
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
      id: 'rename',
      title: tr('commands.rename'),
      hint: hintFor('rename'),
      enabled: !!selected && selectedTracks.length <= 1,
      run: () => setShowRename(true),
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
      id: 'help',
      title: tr('commands.help'),
      enabled: true,
      run: () => setShowHelp(true),
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
  const paletteOpenRef = useRef(false)
  paletteOpenRef.current = showPalette
  const settingsOpenRef = useRef(false)
  settingsOpenRef.current = showSettings
  const helpOpenRef = useRef(false)
  helpOpenRef.current = showHelp
  const findReplaceOpenRef = useRef(false)
  findReplaceOpenRef.current = showFindReplace
  const renameOpenRef = useRef(false)
  renameOpenRef.current = showRename
  const confirmOpenRef = useRef(false)
  confirmOpenRef.current = !!confirm
  // Every modal/overlay that owns the screen must also swallow the global
  // shortcuts, or space/j/k/⌘⏎ would act on the list behind the dialog (e.g.
  // start a conversion behind the confirm prompt).
  const overlayOpenRef = useRef(false)
  overlayOpenRef.current =
    showPalette ||
    showSettings ||
    showHelp ||
    showFindReplace ||
    showRename ||
    !!confirm ||
    showOnboarding

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }
      if (e.key === 'Escape') {
        if (paletteOpenRef.current) setShowPalette(false)
        else if (settingsOpenRef.current) {
          setShowSettings(false)
          setThemePreview(null)
        } else if (helpOpenRef.current) setShowHelp(false)
        else if (findReplaceOpenRef.current) setShowFindReplace(false)
        else if (renameOpenRef.current) setShowRename(false)
        // Onboarding is deliberately omitted: it forces a deliberate choice, not an
        // Escape dismissal.
        else if (confirmOpenRef.current) setConfirm(null)
        return
      }
      if (overlayOpenRef.current) return
      const id = keyToCommandId(
        e,
        isTypingTarget(document.activeElement),
        bindingsRef.current,
        isMac,
      )
      if (id) {
        e.preventDefault()
        runCommand(commandsRef.current, id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
      <header
        className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--color-line)] pr-3 pl-20"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div />
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {batchSummary && !batching && (
            <span data-testid="batch-summary" className="text-sm text-fg-muted">
              {[
                tr('header.batchConverted', { count: batchSummary.converted }),
                batchSummary.skipped > 0 &&
                  tr('header.batchSkipped', { count: batchSummary.skipped }),
                batchSummary.failed > 0 && tr('header.batchFailed', { count: batchSummary.failed }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          )}
          <button
            type="button"
            data-testid="add-files"
            onClick={pickFiles}
            className="press flex h-8 items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
          >
            {tr('header.add')}
          </button>
          {tracks.length > 0 && (
            <>
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-[var(--color-line)]"
              />
              <button
                type="button"
                data-testid="select-all"
                onClick={selectAll}
                aria-label={tr('header.selectAll')}
                className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                <Tooltip label={tr('header.selectAll')} align="end" />
              </button>
              <button
                type="button"
                data-testid="fill-all"
                onClick={askFillAll}
                aria-label={tr('header.fillFromName')}
                className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
                  <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
                <Tooltip label={tr('header.fillFromName')} align="end" />
              </button>
              <button
                type="button"
                data-testid="open-find-replace"
                onClick={() => setShowFindReplace(true)}
                aria-label={tr('commands.findReplace')}
                className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                <Tooltip label={tr('commands.findReplace')} align="end" />
              </button>
              <button
                type="button"
                data-testid="analyze-quality"
                onClick={
                  analysis
                    ? () => {
                        analyzeCancel.current = true
                      }
                    : analyzeAllQuality
                }
                disabled={!analysis && tracks.every((t) => Boolean(t.spectrum))}
                aria-label={tr('header.analyzeQuality')}
                className={`press group relative flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2 hover:bg-[var(--color-panel-2)] disabled:opacity-40 ${
                  analysis
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'w-8 border-[var(--color-line)] text-fg-muted hover:text-fg'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className={`h-4 w-4 ${analysis ? 'animate-pulse' : ''}`}
                >
                  <path d="M3 12h4l2-7 4 14 2-7h4" />
                </svg>
                {analysis && (
                  <span data-testid="analyze-progress" className="text-xs tabular-nums">
                    {analysis.done}/{analysis.total}
                  </span>
                )}
                <Tooltip
                  label={
                    analysis
                      ? tr('header.analyzingCount', { done: analysis.done, total: analysis.total })
                      : tr('header.analyzeQuality')
                  }
                  align="end"
                />
              </button>
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-[var(--color-line)]"
              />
              <button
                type="button"
                data-testid="convert-all"
                onClick={() => processAll()}
                disabled={!canProcessAll}
                className="press flex h-8 items-center rounded-lg bg-[var(--color-accent)] px-3.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
              >
                {batching
                  ? tr('header.convertingCount', {
                      done: batchProgress.done,
                      total: batchProgress.total,
                    })
                  : `${tr('header.convertAll')} (${eligibleCount})`}
              </button>
              {batching && (
                <button
                  type="button"
                  data-testid="cancel-convert-all"
                  onClick={() => {
                    cancelBatchRef.current = true
                  }}
                  className="press flex h-8 items-center rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] px-3.5 text-sm font-medium hover:bg-[var(--color-line-strong)]"
                >
                  {tr('common.cancel')}
                </button>
              )}
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-[var(--color-line)]"
              />
              <button
                type="button"
                data-testid="export-rekordbox"
                onClick={exportRekordbox}
                aria-label={tr('header.exportRekordbox')}
                className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  <path d="M12 3v12" />
                  <path d="m8 7 4-4 4 4" />
                </svg>
                <Tooltip label={tr('header.exportRekordbox')} align="end" />
              </button>
              <div
                aria-hidden="true"
                className="mx-1 h-5 w-px self-center bg-[var(--color-line)]"
              />
              <button
                type="button"
                data-testid="clear-all"
                onClick={askClearAll}
                aria-label={tr('header.clearAll')}
                className="press group relative flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-danger"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                </svg>
                <Tooltip label={tr('header.clearAll')} align="end" />
              </button>
            </>
          )}
          <div aria-hidden="true" className="mx-1 h-5 w-px self-center bg-[var(--color-line)]" />
          <button
            type="button"
            data-testid="open-palette"
            onClick={() => setShowPalette(true)}
            className="press flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            aria-label={tr('header.palette')}
          >
            <kbd className="font-sans">{isMac ? '⌘' : 'Ctrl'}</kbd>
            <kbd className="font-sans">K</kbd>
          </button>
          <button
            type="button"
            data-testid="open-stats"
            onClick={() => openSettings('stats')}
            className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            aria-label={tr('header.stats')}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <line x1="4" y1="20" x2="20" y2="20" />
              <rect x="6" y="12" width="3" height="6" />
              <rect x="11" y="8" width="3" height="10" />
              <rect x="16" y="4" width="3" height="14" />
            </svg>
          </button>
          <button
            type="button"
            data-testid="open-settings"
            onClick={() => openSettings()}
            className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
            aria-label={tr('header.settings')}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          style={{ width: sidebar.width }}
          className="relative shrink-0 bg-[var(--color-panel)]"
        >
          <div className={`h-full overflow-y-auto ${playerVisible && playerTrack ? 'pb-32' : ''}`}>
            {tracks.length === 0 ? (
              <p className="p-6 text-center text-xs text-fg-faint">{tr('sidebar.dropHint')}</p>
            ) : (
              <>
                <div
                  data-testid="quality-filter"
                  className="sticky top-0 z-10 flex gap-0.5 border-b border-[var(--color-line)] bg-[var(--color-panel)] px-1.5 py-2"
                >
                  {(['all', 'unanalyzed', 'suspect', 'good', 'unconverted'] as const).map(
                    (mode) => {
                      const count =
                        mode === 'all'
                          ? tracks.length
                          : mode === 'unanalyzed'
                            ? qualityTally.unanalyzed
                            : mode === 'suspect'
                              ? qualityTally.suspect
                              : mode === 'good'
                                ? qualityTally.good
                                : qualityTally.unconverted
                      const active = qualityFilter === mode
                      const name = tr(`sidebar.filter.${mode}`)
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
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              className="h-4 w-4"
                            >
                              {filterIcon(mode)}
                            </svg>
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
                    },
                  )}
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
                />
              </>
            )}
          </div>
          {playerVisible && playerTrack && (
            <LivePlayer track={playerTrack} audioRef={audioRef} onClose={closePlayer} />
          )}
        </aside>

        <ResizeHandle onPointerDown={sidebar.onPointerDown} />

        <main className="min-w-0 flex-1 bg-[var(--color-panel)]">
          {selected ? (
            <Editor
              key={selected.id}
              item={selected}
              hasToken={!!settings?.discogsToken}
              outputFormat={settings?.outputFormat ?? 'aiff'}
              addToAppleMusic={settings?.addToAppleMusic ?? false}
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
              onProcessAll={(format) => processAll(format, editorNormalizeRef.current ?? undefined)}
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
              onOpenRename={() => setShowRename(true)}
            />
          ) : (
            <div className="flex h-full items-center justify-center p-10 text-center">
              <div className="max-w-sm">
                <svg
                  viewBox="0 0 48 48"
                  fill="currentColor"
                  aria-hidden="true"
                  className="mx-auto mb-5 h-12 w-12 text-fg-faint"
                >
                  <rect x="4" y="19" width="4" height="10" rx="2" />
                  <rect x="10" y="15" width="4" height="18" rx="2" />
                  <rect x="16" y="10" width="4" height="28" rx="2" />
                  <rect x="22" y="5" width="4" height="38" rx="2" />
                  <rect x="28" y="10" width="4" height="28" rx="2" />
                  <rect x="34" y="15" width="4" height="18" rx="2" />
                  <rect x="40" y="19" width="4" height="10" rx="2" />
                </svg>
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

      {showSettings && settings && (
        <SettingsModal
          settings={settings}
          onClose={closeSettings}
          onSave={saveSettings}
          onPreviewTheme={setThemePreview}
          initialTab={settingsTab}
        />
      )}

      {showOnboarding && settings && (
        <OnboardingWizard settings={settings} onFinish={finishOnboarding} />
      )}

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showFindReplace && (
        <FindReplaceModal
          tracks={tracks}
          onApply={deriveTracks}
          onClose={() => setShowFindReplace(false)}
        />
      )}
      {showRename && selected && (
        <RenameModal
          meta={selected.meta}
          initialFormat={settings?.filenameFormat ?? '{artist} - {title}'}
          extension={editorFormatRef.current ?? settings?.outputFormat ?? 'aiff'}
          onApply={(outputName) => updateTrack(selected.id, { outputName })}
          onClose={() => setShowRename(false)}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          confirmDisabled={confirm.confirmDisabled}
          onConfirm={confirm.onConfirm}
          onClose={() => setConfirm(null)}
        />
      )}

      {showPalette && <CommandPalette commands={commands} onClose={() => setShowPalette(false)} />}

      <UpdateToast />
    </div>
  )
}
