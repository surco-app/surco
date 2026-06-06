import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { mediaUrl } from '../../shared/media'
import type { OutputFormat, Settings, ThemePref, TrackMetadata } from '../../shared/types'
import { CommandPalette } from './components/CommandPalette'
import { ConfirmDialog } from './components/ConfirmDialog'
import { Editor } from './components/Editor'
import { FindReplaceModal } from './components/FindReplaceModal'
import { HelpModal } from './components/HelpModal'
import { OnboardingWizard } from './components/OnboardingWizard'
import { Player } from './components/Player'
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle'
import { SettingsModal } from './components/SettingsModal'
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
import { renderOutputName } from './lib/outputName'
import { needsDiscogsPrefetch, needsSpectrum } from './lib/prefetch'
import { applyProgress } from './lib/progress'
import { searchFromTags } from './lib/search'
import { type ClickMods, clickSelect, deselect, type Selection } from './lib/selection'
import { formatShortcut } from './lib/shortcuts'
import { resolveTheme } from './lib/theme'
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

export default function App(): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tracks, setTracks] = useState<TrackItem[]>([])
  const [selection, setSelection] = useState<Selection>({ ids: [], anchor: null })
  const selectedId = selection.anchor
  const selectedIds = selection.ids
  const [showSettings, setShowSettings] = useState(false)
  const [themePreview, setThemePreview] = useState<ThemePref | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [showFindReplace, setShowFindReplace] = useState(false)
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
  const [paused, setPaused] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [batching, setBatching] = useState(false)
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 })
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)

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

  // Stable identity so the memoized TrackRow only re-renders the row that
  // changed. The functional update deselects iff the removed track was selected,
  // which is what the explicit selectedId check did before.
  const removeTrack = useCallback((id: string): void => {
    setTracks((prev) => prev.filter((t) => t.id !== id))
    setSelection((s) => deselect(s, id))
  }, [])

  function clearTracks(): void {
    setTracks([])
    setSelection({ ids: [], anchor: null })
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
    setCurrentTime(0)
    setDuration(0)
  }, [])

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

  async function processOne(id: string, formatOverride?: OutputFormat): Promise<BatchOutcome> {
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
    const format = settings?.filenameFormat ?? '{artist} - {title}'
    const outputName = track.outputName?.trim() || renderOutputName(format, meta) || track.fileName
    try {
      const result = await window.api.processTrack({
        id: track.id,
        inputPath: track.inputPath,
        outputName,
        meta,
        coverUrl: track.coverUrl,
        coverPath: track.coverPath,
        format: formatOverride,
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

  async function processAll(formatOverride?: OutputFormat): Promise<void> {
    if (batching) return
    const ids = eligibleForBatch(tracks)
    setBatching(true)
    setBatchSummary(null)
    setBatchProgress({ done: 0, total: ids.length })
    const results: BatchOutcome[] = []
    try {
      for (const id of ids) {
        results.push(await processOne(id, formatOverride))
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
  }

  const sidebar = useResizableWidth(260, 220, 520)

  const selected = tracks.find((t) => t.id === selectedId) ?? null
  const selectedTracks = tracks.filter((t) => selectedIds.includes(t.id))
  // Falls back to the selection so the card still renders for the brief moment
  // between opening and the first track loading.
  const playerTrack = tracks.find((t) => t.id === playingId) ?? selected

  function pauseResume(): void {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }

  // Reads the live duration off the element rather than closing over state.
  function seekToRatio(ratio: number): void {
    const audio = audioRef.current
    if (audio && Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration
  }

  const playProgress = duration > 0 ? currentTime / duration : 0
  const canProcessSelected =
    !!selected && canProcessTrack(selected, settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS)
  const eligibleCount = eligibleForBatch(tracks).length
  const canProcessAll = eligibleCount > 0 && !batching

  const commands: Command[] = [
    {
      id: 'add',
      title: tr('commands.add'),
      hint: formatShortcut(['mod', 'O'], isMac),
      enabled: true,
      run: pickFiles,
    },
    {
      id: 'find-replace',
      title: tr('commands.findReplace'),
      enabled: tracks.length > 0,
      run: () => setShowFindReplace(true),
    },
    {
      id: 'prev',
      title: tr('commands.prev'),
      hint: '↑',
      enabled: tracks.length > 1,
      run: () => moveSelection(-1),
    },
    {
      id: 'next',
      title: tr('commands.next'),
      hint: '↓',
      enabled: tracks.length > 1,
      run: () => moveSelection(1),
    },
    { id: 'play', title: tr('commands.play'), hint: '␣', enabled: !!selected, run: togglePlay },
    {
      id: 'search',
      title: tr('commands.search'),
      hint: '/',
      enabled: !!selected,
      run: () => searchInputRef.current?.focus(),
    },
    {
      id: 'process-current',
      title: tr('commands.processCurrent'),
      hint: formatShortcut(['mod', 'enter'], isMac),
      enabled: canProcessSelected,
      run: () => selected && processOne(selected.id),
    },
    {
      id: 'process-all',
      title: tr('commands.processAll'),
      hint: formatShortcut(['mod', 'shift', 'enter'], isMac),
      enabled: canProcessAll,
      run: processAll,
    },
    {
      id: 'reveal',
      title: tr('commands.reveal'),
      enabled: !!selected?.outputPath,
      run: () => selected?.outputPath && window.api.reveal(selected.outputPath),
    },
    {
      id: 'add-apple-music',
      title: tr('commands.addAppleMusic'),
      enabled:
        !!selected &&
        canAddToAppleMusic(selected, window.api.platform, settings?.outputFormat ?? 'aiff'),
      run: () => selected && addTrackToAppleMusic(selected.id),
    },
    {
      id: 'remove',
      title: tr('commands.remove'),
      hint: formatShortcut(['mod', 'backspace'], isMac),
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
      hint: formatShortcut(['mod', ','], isMac),
      enabled: true,
      run: () => setShowSettings(true),
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
        return
      }
      if (paletteOpenRef.current || settingsOpenRef.current || helpOpenRef.current) return
      const id = keyToCommandId(e, isTypingTarget(document.activeElement))
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
      {/* Music preview playback — there is no speech to caption. */}
      {/* biome-ignore lint/a11y/useMediaCaption: audio is a music preview, captions don't apply */}
      <audio
        ref={audioRef}
        hidden
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={closePlayer}
      />
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
          {tracks.length > 0 && (
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
                title={tr('header.selectAll')}
                className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
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
              </button>
              <button
                type="button"
                data-testid="fill-all"
                onClick={askFillAll}
                aria-label={tr('header.fillFromName')}
                title={tr('header.fillFromName')}
                className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
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
              </button>
              <button
                type="button"
                data-testid="open-find-replace"
                onClick={() => setShowFindReplace(true)}
                aria-label={tr('commands.findReplace')}
                title={tr('commands.findReplace')}
                className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg"
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
              </button>
              <button
                type="button"
                data-testid="clear-all"
                onClick={askClearAll}
                aria-label={tr('header.clearAll')}
                title={tr('header.clearAll')}
                className="press flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-line)] text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-danger"
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
            data-testid="open-settings"
            onClick={() => setShowSettings(true)}
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
          <div className="h-full overflow-y-auto">
            {tracks.length === 0 ? (
              <p className="p-6 text-center text-xs text-fg-faint">{tr('sidebar.dropHint')}</p>
            ) : (
              <TrackList
                tracks={tracks}
                selectedId={selectedId}
                selectedIds={selectedIds}
                outputFormat={settings?.outputFormat ?? 'aiff'}
                onSelect={onSelectTrack}
                onRemove={removeTrack}
                onPrefetch={handlePrefetch}
              />
            )}
          </div>
          {playerVisible && playerTrack && (
            <Player
              track={playerTrack}
              paused={paused}
              progress={playProgress}
              currentTime={currentTime}
              duration={duration}
              onToggle={pauseResume}
              onSeek={seekToRatio}
              onClose={closePlayer}
            />
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
              filenameFormat={settings?.filenameFormat ?? '{artist} - {title}'}
              groupingPresets={settings?.groupingPresets ?? []}
              visibleFields={settings?.visibleFields ?? DEFAULT_FIELDS}
              requiredFields={settings?.requiredFields ?? DEFAULT_REQUIRED_FIELDS}
              showSpectrum={settings?.showSpectrum ?? true}
              searchInputRef={searchInputRef}
              selectedTracks={selectedTracks}
              onApplyMatches={(patches) => patches.forEach((p) => updateTrack(p.id, p.patch))}
              onProcessAll={processAll}
              onAddAllToAppleMusic={() => addAllToAppleMusic(selectedIds)}
              onChangeAllMeta={(patch) => updateTracksMeta(selectedIds, patch)}
              onApplyCoverAll={(coverUrl, coverPath) => patchTracks(selectedIds, { coverUrl, coverPath })}
              onDeriveTags={deriveTracks}
              onChange={(patch) => updateTrack(selected.id, patch)}
              onProcess={(format) => processOne(selected.id, format)}
              onAddToAppleMusic={() => addTrackToAppleMusic(selected.id)}
              onOpenSettings={() => setShowSettings(true)}
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
