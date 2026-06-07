import type React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { formatMatchesInput } from '../../../shared/format'
import type {
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsTrack,
  NormalizeConfig,
  OutputFormat,
  TrackMetadata,
} from '../../../shared/types'
import { BULK_FIELDS, commonValue } from '../lib/bulkEdit'
import { csvHas, toggleCsv } from '../lib/csv'
import { smartDeriveTags } from '../lib/deriveTags'
import { isStale } from '../lib/dirty'
import { formatTime } from '../lib/duration'
import { openFeedback } from '../lib/feedback'
import { FIELD_DEFS, missingRequired } from '../lib/fields'
import { genrePresets as discogsGenres } from '../lib/genre'
import { formatFileSize } from '../lib/properties'
import {
  formatDb,
  formatKHz,
  formatPercent,
  type Grade,
  gradeBalance,
  gradeCrest,
  gradeDcOffset,
  gradeLra,
  gradeLufs,
  gradeNoiseFloor,
  gradeTruePeak,
  isLowResCover,
  qualityVerdict,
} from '../lib/quality'
import {
  bestMatch,
  buildReleaseMeta,
  confidenceTier,
  type ReleaseMetaPatch,
  resultFromRelease,
  stepImageIndex,
} from '../lib/release'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'
import { AlbumMatchRows } from './AlbumMatchRows'
import { LoudnessHelpModal } from './LoudnessHelpModal'
import { NormalizeControls } from './NormalizeControls'
import { ResizeHandle, useResizableWidth } from './ResizeHandle'
import { Spectrogram } from './Spectrogram'
import { Tooltip } from './Tooltip'
import { WaveSpinner } from './WaveSpinner'

const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']

// How many search results to probe for the file's track before giving up. The
// probe loads a full release per result, so this caps the Discogs calls a single
// search can make and keeps it well under the rate limit.
const MAX_AUTO_PROBE = 8

// Per-grade colour for the analysis stat cells, reusing the good/warn/danger
// tokens (Tokyo Night). The dot is a solid status light; the value text carries
// the same colour so the verdict reads at a glance.
const GRADE_DOT: Record<Grade, string> = {
  good: 'bg-good',
  warn: 'bg-warn',
  bad: 'bg-danger',
}
const GRADE_TEXT: Record<Grade, string> = {
  good: 'text-good',
  warn: 'text-warn',
  bad: 'text-danger',
}

interface Props {
  item: TrackItem
  hasToken: boolean
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  groupingPresets: string[]
  genrePresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  showSpectrum: boolean
  showLoudness: boolean
  // The Settings normalization default, seeding the per-track override control.
  normalize: NormalizeConfig
  searchInputRef: React.RefObject<HTMLInputElement | null>
  // The whole multi-selection, when more than one track is picked. Its presence flips the
  // Discogs column to album-match mode (map every file to a tracklist entry at once) and
  // the convert action to "convert all"; the right-hand editor still shows `item`, the
  // primary track. Undefined/length<=1 means the ordinary single-track editor.
  selectedTracks?: TrackItem[]
  onApplyMatches?: (patches: { id: string; patch: ReleaseMetaPatch }[]) => void
  onProcessAll?: (format: OutputFormat) => void
  onAddAllToAppleMusic?: () => void
  // Multi-select writes: a field edited in the shared form goes to every selected track,
  // and a dropped/picked cover is stamped onto all of them.
  onChangeAllMeta?: (patch: Partial<TrackMetadata>) => void
  onApplyCoverAll?: (coverUrl: string, coverPath: string) => void
  // Fills each track's tags from its own file name; applies to the primary in single view
  // and to the whole selection in multi.
  onDeriveTags?: (patches: { id: string; meta: Partial<TrackMetadata> }[]) => void
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: (format: OutputFormat) => void
  // Reports the format chosen in the split-button menu so the keyboard convert
  // shortcuts (⌘⏎ / ⌘⇧⏎) export in it too, instead of the Settings default.
  onFormatChange?: (format: OutputFormat) => void
  // Reports the per-track normalization override so the keyboard convert shortcuts
  // and "convert all" apply it too, mirroring onFormatChange.
  onNormalizeChange?: (normalize: NormalizeConfig) => void
  onAddToAppleMusic: () => void
  // Trashes the source file after a real conversion; the converted output and the
  // track's row stay. Confirmation lives in App, so the button just signals intent.
  onTrashOriginal?: () => void
  onOpenSettings: (tab?: 'general' | 'naming') => void
  // Opens the output-name pattern builder for this track (App owns the modal so the
  // ⌘⇧R shortcut and the menu can open it too).
  onOpenRename: () => void
}

export function Editor({
  item,
  hasToken,
  outputFormat,
  addToAppleMusic,
  groupingPresets,
  genrePresets,
  visibleFields,
  requiredFields,
  showSpectrum,
  showLoudness,
  normalize,
  searchInputRef,
  selectedTracks,
  onApplyMatches,
  onProcessAll,
  onAddAllToAppleMusic,
  onChangeAllMeta,
  onApplyCoverAll,
  onDeriveTags,
  onChange,
  onProcess,
  onFormatChange,
  onNormalizeChange,
  onAddToAppleMusic,
  onTrashOriginal,
  onOpenSettings,
  onOpenRename,
}: Props): React.JSX.Element {
  const isMulti = (selectedTracks?.length ?? 0) > 1
  // In multi-select the cover is whatever the tracks already share (or nothing, when they
  // differ); a drop/pick stamps it onto all of them instead of just the primary track.
  const sharedCover =
    isMulti && selectedTracks?.every((t) => t.coverUrl === selectedTracks[0].coverUrl)
      ? selectedTracks[0].coverUrl
      : undefined
  const displayCover = isMulti ? sharedCover : item.coverUrl
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState(item.query)
  const [results, setResults] = useState<DiscogsSearchResult[]>([])
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingId, setLoadingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [coverDragging, setCoverDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  const [formOpen, setFormOpen] = useState(true)
  // Read-only facts, folded by default so they don't push the editing fields down;
  // the user opens them when they want to inspect the source.
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [spectrumOpen, setSpectrumOpen] = useState(true)
  // The loudness help is hidden by default and toggled by the ⓘ button: the
  // figures need explaining once, but shouldn't clutter the panel on every edit.
  const [loudnessHelpOpen, setLoudnessHelpOpen] = useState(false)
  const [outputOpen, setOutputOpen] = useState(true)
  // Normalization is off by default and most users won't touch it, so its section
  // starts folded — unlike the always-on Metadata/Quality/File name sections.
  const [normalizeOpen, setNormalizeOpen] = useState(false)
  // The chosen export format, seeded from the Settings default. The format menu
  // only updates this; conversion waits for a deliberate click on the main button.
  // The Editor remounts per track (key={track.id}), so each track starts from the
  // default rather than inheriting the last track's pick.
  const [format, setFormat] = useState(outputFormat)
  // Per-track normalization, seeded from the Settings default. Editing it both
  // updates the control and reports the override up so convert uses it.
  const [normalizeCfg, setNormalizeCfg] = useState(normalize)
  const [inLibrary, setInLibrary] = useState<'idle' | 'yes' | 'no'>('idle')
  // Natural pixel size of the shown artwork, read on load, so the user can tell
  // whether the Discogs cover is sharp enough or worth replacing. Null until loaded
  // and reset whenever the cover changes.
  const [coverDims, setCoverDims] = useState<{ w: number; h: number } | null>(null)
  // The artwork the file arrived with, captured once per track (the Editor remounts
  // per track via key={track.id}). Applying a release can leave it in place, and the
  // picker lists it first so the user can step to the release's images and back.
  const [originalCover] = useState<{ url?: string; path?: string }>(() => ({
    url: item.coverUrl,
    path: item.coverPath,
  }))
  const releaseRef = useRef<DiscogsRelease | null>(null)
  // Bumped on every search so an in-flight auto-probe from a superseded search
  // bails instead of opening a release the user is no longer looking for.
  const searchToken = useRef(0)
  const coverDragPath = useRef<string | null>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const discogs = useResizableWidth(315, 300, 720)

  // startDrag needs a file on disk the instant the drag begins, so prepare the
  // processed cover whenever it changes and stash its path for onDragStart.
  useEffect(() => {
    coverDragPath.current = null
    if (!item.coverUrl && !item.coverPath) return
    let cancelled = false
    window.api
      .prepareCoverDrag({ coverUrl: item.coverUrl, coverPath: item.coverPath })
      .then((path) => {
        if (!cancelled) coverDragPath.current = path
      })
    return () => {
      cancelled = true
    }
  }, [item.coverUrl, item.coverPath])

  // Clear the stale size when the artwork changes; onLoad fills it in again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: displayCover is the trigger to reset, not a value read in the body.
  useEffect(() => setCoverDims(null), [displayCover])

  // Walk the results from the top, load each release's tracklist, and open the
  // first one that confidently holds the file's track — so the user lands on the
  // right album instead of opening each result by hand. Capped and cancellable so
  // it bounds the Discogs calls and a newer search wins.
  async function autoOpenMatch(found: DiscogsSearchResult[], token: number): Promise<void> {
    if (!item.meta.title.trim()) return
    for (const result of found.slice(0, MAX_AUTO_PROBE)) {
      let rel: DiscogsRelease
      try {
        rel = await loadRelease(result.id)
      } catch {
        continue
      }
      if (searchToken.current !== token) return
      const m = bestMatch(rel.tracklist, {
        title: item.meta.title,
        durationSec: item.duration,
        trackNumber: item.meta.trackNumber,
        artist: item.meta.artist,
      })
      if (m && confidenceTier(m.confidence) !== 'low') {
        setRelease(rel)
        return
      }
    }
  }

  async function doSearch(): Promise<void> {
    if (!query.trim()) return
    const token = ++searchToken.current
    setBusy(true)
    setError('')
    setRelease(null)
    try {
      const id = parseReleaseId(query)
      if (id !== null) {
        const rel = await loadRelease(id)
        setResults([resultFromRelease(rel)])
        setRelease(rel)
      } else {
        const found = await window.api.searchDiscogs(query)
        if (searchToken.current !== token) return
        setResults(found)
        await autoOpenMatch(found, token)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.searchError'))
    } finally {
      if (searchToken.current === token) setBusy(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: must depend on the query value, not doSearch's identity — with doSearch the effect re-ran every render and looped search requests until Discogs returned 429. Debounced so a search fires once, 500ms after typing stops.
  useEffect(() => {
    if (!query.trim()) return
    const id = setTimeout(() => void doSearch(), 500)
    return () => clearTimeout(id)
  }, [query])

  // biome-ignore lint/correctness/useExhaustiveDependencies: must analyze once per input, not on onChange/tr/spectrum identity — depending on those restarted analysis mid-flight, and a superseded run's cleanup left the spinner stranded (its finally never ran). The Editor remounts per track (key={track.id}), so keying on inputPath runs it exactly once. showSpectrum is included so enabling the section later analyzes the current track instead of waiting for a track switch.
  useEffect(() => {
    if (!showSpectrum || item.spectrum) return
    let active = true
    setAnalyzing(true)
    setAnalyzeError('')
    window.api
      .spectrogram(item.inputPath)
      .then((res) => {
        if (active) onChange({ spectrum: res })
      })
      .catch((e) => {
        if (active) setAnalyzeError(e instanceof Error ? e.message : tr('editor.analyzeError'))
      })
      .finally(() => {
        if (active) setAnalyzing(false)
      })
    return () => {
      active = false
    }
  }, [item.inputPath, showSpectrum])

  // biome-ignore lint/correctness/useExhaustiveDependencies: same once-per-input rule as the spectrum effect above — the Editor remounts per track (key={track.id}), so keying on inputPath measures exactly once; showLoudness is included so enabling the readout later measures the current track instead of waiting for a track switch. item.loudness is intentionally not a dependency: a finished measurement (including a null failure) must not retrigger it.
  useEffect(() => {
    if (!showLoudness || item.loudness !== undefined) return
    let active = true
    window.api
      .loudness(item.inputPath)
      .then((res) => {
        if (active) onChange({ loudness: res })
      })
      .catch(() => {
        if (active) onChange({ loudness: null })
      })
    return () => {
      active = false
    }
  }, [item.inputPath, showLoudness])

  // biome-ignore lint/correctness/useExhaustiveDependencies: same once-per-input rule — keyed on inputPath so it probes exactly once. Properties are always shown for a single track (no toggle), so unlike spectrum/loudness this isn't gated on a setting; isMulti hides the panel instead. item.properties is intentionally not a dependency so a finished probe (including a null failure) never retriggers.
  useEffect(() => {
    if (isMulti || item.properties !== undefined) return
    let active = true
    window.api
      .properties(item.inputPath)
      .then((res) => {
        if (active) onChange({ properties: res })
      })
      .catch(() => {
        if (active) onChange({ properties: null })
      })
    return () => {
      active = false
    }
  }, [item.inputPath, isMulti])

  // Checking whether the song is already in the Apple Music library is a hint to
  // avoid duplicating tracks, so it tracks the live title/artist (debounced —
  // each lookup spawns an osascript) rather than only firing on a Discogs apply.
  // It is macOS-only; elsewhere there is no library to query, so the badge hides.
  const { title: metaTitle, artist: metaArtist } = item.meta
  useEffect(() => {
    if (window.api.platform !== 'darwin' || !metaTitle.trim() || !metaArtist.trim()) {
      setInLibrary('idle')
      return
    }
    let active = true
    const id = setTimeout(() => {
      window.api
        .lookupAppleMusic(metaArtist, metaTitle)
        .then((found) => {
          if (active) setInLibrary(found ? 'yes' : 'no')
        })
        .catch(() => {
          if (active) setInLibrary('idle')
        })
    }, 600)
    return () => {
      active = false
      clearTimeout(id)
    }
  }, [metaTitle, metaArtist])

  async function loadRelease(id: number): Promise<DiscogsRelease> {
    if (releaseRef.current?.id === id) return releaseRef.current
    const rel = await window.api.getRelease(id)
    releaseRef.current = rel
    return rel
  }

  // A single click only previews the release (loads its tracklist) — it must
  // not touch the song's data, so browsing results never clobbers what the user
  // already entered. Applying the metadata is the deliberate double click.
  async function previewRelease(result: DiscogsSearchResult): Promise<void> {
    // Clicking the open release again collapses it; the ref keeps the tracklist
    // cached so reopening doesn't refetch.
    if (release?.id === result.id) {
      setRelease(null)
      return
    }
    if (releaseRef.current?.id === result.id) {
      setRelease(releaseRef.current)
      return
    }
    setBusy(true)
    setLoadingId(result.id)
    setError('')
    try {
      setRelease(await loadRelease(result.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.releaseError'))
    } finally {
      setBusy(false)
      setLoadingId(null)
    }
  }

  function selectTrack(track: DiscogsTrack): void {
    if (!release) return
    // Keep the file's own cover unless it's missing or measured as low-res, in which
    // case the release fills it. Keeping is the safe default — when the size hasn't
    // been measured yet (coverDims null) a present cover is left untouched rather
    // than overwritten with the release's often-smaller image.
    onChange(
      buildReleaseMeta(item.meta, release, track, {
        url: item.coverUrl,
        path: item.coverPath,
        keep: !!item.coverUrl && !(coverDims && isLowResCover(coverDims.w, coverDims.h)),
      }),
    )
  }

  function setField(key: keyof TrackItem['meta'], value: string): void {
    onChange({ meta: { ...item.meta, [key]: value } })
  }

  // Fills tags from each file's own name (auto-detecting the common rip naming): the primary
  // track in single view, every selected track in multi. Merges, so only matched fields change.
  function deriveFromNames(): void {
    if (!onDeriveTags) return
    const targets = isMulti ? (selectedTracks ?? []) : [item]
    const patches = targets
      .map((f) => ({ id: f.id, meta: smartDeriveTags(f.fileName) }))
      .filter((p) => Object.keys(p.meta).length > 0)
    if (patches.length) onDeriveTags(patches)
  }

  function applyImageFile(file: File | undefined): void {
    if (!file?.type.startsWith('image/')) return
    const coverUrl = URL.createObjectURL(file)
    const coverPath = window.api.getPathForFile(file)
    if (isMulti) onApplyCoverAll?.(coverUrl, coverPath)
    else onChange({ coverUrl, coverPath, coverRemoved: false })
  }

  function onCoverRemove(): void {
    onChange({ coverUrl: undefined, coverPath: undefined, coverRemoved: true })
  }

  function onCoverDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setCoverDragging(false)
    applyImageFile(Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/')))
  }

  // The covers the picker steps through: the file's own artwork first, then the
  // release's images (deduped), so the original sits at index 0 and Discogs'
  // alternatives are one step away — and reachable again after stepping off.
  const coverChoices = useMemo(() => {
    const choices: { uri: string; path?: string }[] = []
    if (originalCover.url) choices.push({ uri: originalCover.url, path: originalCover.path })
    for (const im of release?.images ?? [])
      if (im.uri !== originalCover.url) choices.push({ uri: im.uri })
    return choices
  }, [release, originalCover])

  // Switches the cover among the picker's choices (the original plus the release's
  // images). It only swaps the artwork, leaving the rest of the metadata untouched.
  function pickCoverImage(delta: number): void {
    const i = stepImageIndex(coverChoices, item.coverUrl, delta)
    if (i >= 0)
      onChange({
        coverUrl: coverChoices[i].uri,
        coverPath: coverChoices[i].path,
        coverRemoved: false,
      })
  }

  function onCoverExport(): void {
    if (!item.coverUrl) return
    void window.api.exportCover({
      name: item.outputName ?? defaultOutputName,
      coverUrl: item.coverUrl,
      coverPath: item.coverPath,
    })
  }

  const stale = isStale(item)
  // A stale track is done but edited since, so it shows the convert button again
  // (as "Update") rather than the done/reveal state.
  const done = item.status === 'done' && !stale
  const exportedExt = item.outputPath?.split('.').pop()?.toLowerCase()
  const exportedFormat = FORMATS.find((f) => f === exportedExt) ?? null
  // The post-convert actions (reveal + Apple Music) are reused in multi-select, just fed
  // aggregate values: the block shows once every selected track is converted, reveal
  // opens the first output, and the Apple Music button reflects the whole selection.
  const multiTracks = selectedTracks ?? []
  const showDone = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.status === 'done')
    : done
  const revealPath = isMulti ? multiTracks.find((t) => t.outputPath)?.outputPath : item.outputPath
  // A real conversion writes a separate file and leaves the source at its own path;
  // an in-place export rewrites the source, so inputPath === outputPath and there is
  // nothing distinct to trash. Single-track only, and gone once the original is trashed.
  const canDeleteOriginal =
    !isMulti && !!item.outputPath && item.outputPath !== item.inputPath && !item.originalTrashed
  const musicExt = isMulti ? format : exportedFormat
  const musicAdding = isMulti
    ? multiTracks.some((t) => t.musicStatus === 'adding')
    : item.musicStatus === 'adding'
  const musicAdded = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.musicStatus === 'added')
    : item.musicStatus === 'added'
  const musicError = isMulti
    ? multiTracks.find((t) => t.musicStatus === 'error')?.musicError
    : item.musicError
  // Required fields are flagged the moment they are empty, not only after a failed
  // convert: with the button disabled below, the click that produced the error is
  // no longer reachable, so the red field is what tells the user why.
  const incomplete = missingRequired(item.meta, requiredFields).length > 0
  // The user's default genres come first so they're always one click away even
  // when a release isn't on Discogs; the release's own genres/styles follow,
  // deduped so a shared name shows a single pill.
  const genreChips = useMemo(
    () => Array.from(new Set([...genrePresets, ...discogsGenres(release)])),
    [genrePresets, release],
  )
  // Highlight the tracklist entry whose title best matches the file's, so the
  // right mix is preselected the moment the release loads. Fuzzy, so the
  // filename's case and punctuation don't have to match Discogs exactly. The user
  // still picks deliberately — this only points; it never applies on its own.
  // Memoized on its inputs so typing in unrelated fields doesn't re-run the fuzzy
  // match over the whole tracklist on every keystroke.
  const match = useMemo(
    () =>
      release
        ? bestMatch(release.tracklist, {
            title: item.meta.title,
            durationSec: item.duration,
            trackNumber: item.meta.trackNumber,
            artist: item.meta.artist,
          })
        : undefined,
    [release, item.meta.title, item.duration, item.meta.trackNumber, item.meta.artist],
  )
  const matchTier = match ? confidenceTier(match.confidence) : undefined
  // 'low' is too weak to trust, so it points at nothing — otherwise loading an
  // unrelated release still badges whichever mix shares an incidental word.
  const matchedTrack = matchTier && matchTier !== 'low' ? match?.track : undefined
  // Default to the file's own name so converting keeps it; the metadata-derived
  // name is opt-in via the "Regenerate from metadata" button below.
  const defaultOutputName = item.fileName
  // Exporting to the source's own format edits the original file in place (and
  // renames it on disk) rather than writing a copy to the output folder — warn the
  // user before they hit the button so the rename isn't a surprise.
  const willEditInPlace = formatMatchesInput(format, item.inputPath)

  // One-click "fill tags from the file name", shown in the File Name section (single) and
  // the form header (multi, where File Name is hidden).
  const deriveButton = onDeriveTags ? (
    <button
      type="button"
      data-testid="derive-btn"
      onClick={deriveFromNames}
      className="press group relative flex items-center gap-1.5 rounded-md text-xs text-fg-dim hover:text-fg"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-3 w-3"
      >
        <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
        <circle cx="7.5" cy="7.5" r=".5" fill="currentColor" />
      </svg>
      {tr('editor.deriveFromName')}
      <Tooltip label={tr('editor.deriveFromNameHint')} align="start" />
    </button>
  ) : null

  return (
    <div className="flex h-full min-h-0">
      <div
        style={{ width: discogs.width }}
        className="flex shrink-0 flex-col border-r border-[var(--color-line)]"
      >
        <div className="border-b border-[var(--color-line)] p-3">
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              data-testid="discogs-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder={tr('editor.searchPlaceholder')}
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              type="button"
              data-testid="discogs-search"
              onClick={doSearch}
              disabled={busy}
              className="press inline-flex h-9 items-center justify-center rounded-lg bg-[var(--color-accent)] px-3.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {tr('editor.search')}
            </button>
          </div>
          {!hasToken && (
            <p className="mt-2 text-xs text-fg-muted">
              <Trans
                i18nKey="editor.tokenTip"
                components={[
                  <button
                    key="settings"
                    type="button"
                    onClick={() => onOpenSettings()}
                    className="underline underline-offset-2 hover:no-underline"
                  />,
                ]}
              />
            </p>
          )}
          {error && <p className="mt-2 text-xs text-danger">{error}</p>}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {results.length === 0 ? (
            <p className="px-3 pt-3 text-xs text-fg-faint">{tr('editor.chooseAlbumHint')}</p>
          ) : (
            results.map((r) => {
              const expanded = loadingId !== null ? loadingId === r.id : release?.id === r.id
              const loaded = release?.id === r.id
              return (
                <div key={r.id} className="border-b border-[var(--color-line)]/60">
                  <button
                    type="button"
                    data-testid="discogs-result"
                    aria-expanded={expanded}
                    onClick={() => previewRelease(r)}
                    className={`group relative flex w-full items-center gap-3 p-2.5 text-left hover:bg-[var(--color-panel-2)] ${
                      expanded ? 'bg-[var(--color-accent-soft)]' : ''
                    }`}
                  >
                    {r.thumb ? (
                      <img
                        src={r.thumb}
                        alt=""
                        loading="lazy"
                        className="h-11 w-11 shrink-0 rounded-md object-cover outline outline-1 -outline-offset-1 outline-white/10"
                      />
                    ) : (
                      <div className="h-11 w-11 shrink-0 rounded-md bg-[var(--color-panel-2)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.title}</span>
                      <span className="block truncate text-xs text-fg-dim">
                        {[r.year, r.label?.[0], r.format?.join(', ')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <svg
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                      className={`h-3 w-3 shrink-0 text-fg-faint transition-transform ${expanded ? 'rotate-90' : ''}`}
                    >
                      <path
                        d="m4.5 2.5 3.5 3.5-3.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <Tooltip label={tr('editor.resultHint')} align="start" />
                  </button>
                  <CollapsibleTracks open={expanded}>
                    <div className="pb-1">
                      <p className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                        {isMulti ? tr('match.title') : tr('editor.chooseTrack')}
                      </p>
                      {loaded && release ? (
                        isMulti && selectedTracks && onApplyMatches ? (
                          <AlbumMatchRows
                            files={selectedTracks}
                            release={release}
                            onApply={onApplyMatches}
                          />
                        ) : (
                          release.tracklist.map((t) => (
                            <button
                              key={`${t.position}-${t.title}`}
                              type="button"
                              data-testid="discogs-track"
                              aria-current={t === matchedTrack ? 'true' : undefined}
                              onClick={() => selectTrack(t)}
                              className={`flex w-full items-center gap-3 py-1.5 pr-3 pl-4 text-left hover:bg-[var(--color-panel-2)] ${
                                t === matchedTrack ? 'bg-[var(--color-accent-soft)]' : ''
                              }`}
                            >
                              <span className="w-8 shrink-0 text-xs tabular-nums text-fg-dim">
                                {t.position}
                              </span>
                              <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                              {t === matchedTrack && matchTier && (
                                // A text label, not a tick: a check icon reads as
                                // "already applied", but the metadata is only applied
                                // when the row is clicked. The tier color tells the
                                // user whether to trust the suggestion or double-check.
                                <span
                                  data-testid="track-confidence"
                                  data-confidence={matchTier}
                                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                    matchTier === 'high'
                                      ? 'bg-good/15 text-good'
                                      : 'bg-warn/15 text-warn'
                                  }`}
                                >
                                  {tr('editor.matchSuggested')}
                                </span>
                              )}
                              {t.duration && (
                                <span className="shrink-0 text-xs tabular-nums text-fg-dim">
                                  {t.duration}
                                </span>
                              )}
                            </button>
                          ))
                        )
                      ) : (
                        <TrackSkeleton />
                      )}
                    </div>
                  </CollapsibleTracks>
                </div>
              )
            })
          )}
        </div>
      </div>

      <ResizeHandle onPointerDown={discogs.onPointerDown} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <SectionHeader
            title={
              isMulti
                ? tr('editor.editingMultiple', { count: selectedTracks?.length ?? 0 })
                : tr('editor.sectionForm')
            }
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            right={
              <div className="flex items-center gap-3">
                {deriveButton}
                {!isMulti && inLibrary === 'yes' && (
                  <span
                    data-testid="apple-music-status"
                    className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                  >
                    {tr('editor.inLibrary')}
                  </span>
                )}
                {!isMulti && inLibrary === 'no' && (
                  <span
                    data-testid="apple-music-status"
                    className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                  >
                    {tr('editor.notInLibrary')}
                  </span>
                )}
              </div>
            }
          />
          {formOpen && (
            <div className="mt-4 @container">
              {!isMulti && (
                <div className="mb-4 flex items-center gap-3">
                  <span className="text-xs font-medium text-fg-dim">{tr('fields.rating')}</span>
                  <StarRating
                    value={item.meta.rating ?? ''}
                    onChange={(v) => setField('rating', v)}
                  />
                </div>
              )}
              <div className="flex flex-col gap-5 @[26rem]:flex-row @[26rem]:gap-6">
                {/* Dragging an image is a pointer-only convenience; artwork is also set from a Discogs release. */}
                {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target, not a control */}
                <div
                  data-testid="cover-dropzone"
                  onDragOver={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setCoverDragging(true)
                  }}
                  onDragLeave={(e) => {
                    e.stopPropagation()
                    setCoverDragging(false)
                  }}
                  onDrop={onCoverDrop}
                  className="shrink-0 self-start"
                >
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    data-testid="cover-input"
                    className="hidden"
                    onChange={(e) => {
                      applyImageFile(e.target.files?.[0])
                      e.target.value = ''
                    }}
                  />
                  {displayCover ? (
                    <div className="group relative w-40">
                      <img
                        data-testid="cover-preview"
                        src={displayCover}
                        alt={tr('editor.coverAlt')}
                        draggable={!isMulti}
                        onLoad={(e) =>
                          setCoverDims({
                            w: e.currentTarget.naturalWidth,
                            h: e.currentTarget.naturalHeight,
                          })
                        }
                        onDragStart={(e) => {
                          if (isMulti || !coverDragPath.current) return
                          e.preventDefault()
                          window.api.startCoverDrag(coverDragPath.current)
                        }}
                        className={`h-40 w-40 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10 ${
                          coverDragging ? 'ring-2 ring-[var(--color-accent)]' : ''
                        }`}
                      />
                      {!isMulti && (
                        <>
                          <button
                            type="button"
                            data-testid="cover-remove"
                            onClick={onCoverRemove}
                            aria-label={tr('editor.coverRemove')}
                            className="press group/cover absolute top-2 right-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/75"
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
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                            <Tooltip label={tr('editor.coverRemove')} align="end" scope="cover" />
                          </button>
                          <button
                            type="button"
                            data-testid="cover-export"
                            onClick={onCoverExport}
                            aria-label={tr('editor.coverExport')}
                            className="press group/cover absolute right-2 bottom-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/75"
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
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <path d="M7 10l5 5 5-5" />
                              <path d="M12 15V3" />
                            </svg>
                            <Tooltip label={tr('editor.coverExport')} align="end" scope="cover" />
                          </button>
                        </>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="cover-pick"
                      onClick={() => coverInputRef.current?.click()}
                      className={`flex h-40 w-40 items-center justify-center rounded-xl border border-dashed p-2 text-center text-xs ${
                        coverDragging
                          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                          : 'border-[var(--color-line)] text-fg-faint hover:border-[var(--color-line-strong)]'
                      }`}
                    >
                      {coverDragging ? tr('editor.coverDropActive') : tr('editor.coverDrop')}
                    </button>
                  )}
                  {!isMulti && coverChoices.length > 1 && (
                    <div
                      data-testid="cover-image-picker"
                      className="mt-1.5 flex items-center justify-center gap-2"
                    >
                      <button
                        type="button"
                        data-testid="cover-prev"
                        aria-label={tr('editor.coverPrev')}
                        onClick={() => pickCoverImage(-1)}
                        className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
                      >
                        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="h-3 w-3">
                          <path
                            d="m7.5 2.5-3.5 3.5 3.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <span
                        data-testid="cover-image-count"
                        className="text-[11px] tabular-nums text-fg-dim"
                      >
                        {(() => {
                          const pos = coverChoices.findIndex((c) => c.uri === item.coverUrl) + 1
                          return `${pos > 0 ? pos : '–'}/${coverChoices.length}`
                        })()}
                      </span>
                      <button
                        type="button"
                        data-testid="cover-next"
                        aria-label={tr('editor.coverNext')}
                        onClick={() => pickCoverImage(1)}
                        className="press flex h-6 w-6 items-center justify-center rounded-md text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
                      >
                        <svg viewBox="0 0 12 12" fill="none" aria-hidden="true" className="h-3 w-3">
                          <path
                            d="m4.5 2.5 3.5 3.5-3.5 3.5"
                            stroke="currentColor"
                            strokeWidth="1.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  )}
                  {displayCover && coverDims && (
                    <div
                      data-testid="cover-resolution"
                      className="mt-1.5 flex items-center justify-center gap-1.5 text-[11px]"
                    >
                      <span
                        data-testid="cover-quality-dot"
                        data-lowres={isLowResCover(coverDims.w, coverDims.h)}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          isLowResCover(coverDims.w, coverDims.h) ? 'bg-warn' : 'bg-good'
                        }`}
                      />
                      <span className="tabular-nums text-fg-dim">
                        {coverDims.w} × {coverDims.h} px
                      </span>
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-1 gap-x-4 gap-y-3 @[26rem]:grid-cols-2">
                  {isMulti && selectedTracks
                    ? BULK_FIELDS.map((key) => {
                        const shared = commonValue(selectedTracks, key)
                        return (
                          <Field
                            key={key}
                            name={key}
                            label={tr(`fields.${key}`)}
                            value={shared ?? ''}
                            placeholder={
                              shared === undefined ? tr('editor.multipleValues') : undefined
                            }
                            onChange={(v) => onChangeAllMeta?.({ [key]: v })}
                            suggestions={
                              key === 'genre'
                                ? genreChips
                                : key === 'grouping'
                                  ? groupingPresets
                                  : undefined
                            }
                            multiSuggestions={key === 'grouping'}
                          />
                        )
                      })
                    : visibleFields.map((key) => {
                        const def = FIELD_DEFS.find((d) => d.key === key)
                        if (!def) return null
                        return (
                          <Field
                            key={def.key}
                            name={def.key}
                            label={tr(`fields.${def.key}`)}
                            value={item.meta[def.key] ?? ''}
                            onChange={(v) => setField(def.key, v)}
                            wide={def.wide}
                            invalid={
                              requiredFields.includes(def.key) && !item.meta[def.key]?.trim()
                            }
                            suggestions={
                              def.key === 'genre'
                                ? genreChips
                                : def.key === 'grouping'
                                  ? groupingPresets
                                  : undefined
                            }
                            multiSuggestions={def.key === 'grouping'}
                          />
                        )
                      })}
                </div>
              </div>
            </div>
          )}

          {!isMulti && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.propertiesTitle')}
                open={propertiesOpen}
                onToggle={() => setPropertiesOpen((v) => !v)}
              />
              {propertiesOpen &&
                (item.properties
                  ? (() => {
                      const p = item.properties
                      const ext = item.fileName.includes('.')
                        ? (item.fileName.split('.').pop() ?? '').toUpperCase()
                        : ''
                      // Show only the containing folder's name (the full path lives in
                      // the tooltip) so the long absolute path doesn't blow out the row.
                      const folderName =
                        item.inputPath
                          .slice(
                            0,
                            Math.max(
                              item.inputPath.lastIndexOf('/'),
                              item.inputPath.lastIndexOf('\\'),
                            ),
                          )
                          .split(/[/\\]/)
                          .pop() || item.inputPath
                      const modeKey =
                        p.channels <= 1 ? 'Mono' : p.channels === 2 ? 'Stereo' : 'Multi'
                      const fmtDate = (ms: number | null): string =>
                        ms === null
                          ? ''
                          : new Date(ms).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })
                      type PropRow = { id: string; label: string; value: string; full?: string }
                      const row = (
                        id: string,
                        label: string,
                        value: string,
                        full?: string,
                      ): PropRow | false => (value ? { id, label, value, full } : false)
                      const isRow = (r: PropRow | false): r is PropRow => r !== false
                      const groups = [
                        {
                          id: 'audio',
                          label: tr('editor.propertiesGroupAudio'),
                          rows: [
                            row('kind', tr('editor.propKind'), p.container.toUpperCase()),
                            row('codec', tr('editor.propCodec'), p.codec),
                            row(
                              'sampleRate',
                              tr('editor.propSampleRate'),
                              p.sampleRateHz ? formatKHz(p.sampleRateHz) : '',
                            ),
                            row(
                              'bitDepth',
                              tr('editor.propBitDepth'),
                              p.bitDepth !== null
                                ? tr('editor.propBitDepthValue', { bits: p.bitDepth })
                                : '',
                            ),
                            row(
                              'channels',
                              tr('editor.propChannels'),
                              p.channels ? String(p.channels) : '',
                            ),
                            row(
                              'channelMode',
                              tr('editor.propChannelMode'),
                              p.channels ? tr(`editor.channelMode${modeKey}`) : '',
                            ),
                            row(
                              'bitrate',
                              tr('editor.propBitrate'),
                              p.bitrateKbps !== null
                                ? tr('editor.propBitrateValue', { kbps: p.bitrateKbps })
                                : '',
                            ),
                            row(
                              'duration',
                              tr('editor.propDuration'),
                              item.duration !== undefined ? formatTime(item.duration) : '',
                            ),
                            row('tagFormats', tr('editor.propTagFormats'), p.tagFormats.join(', ')),
                          ].filter(isRow),
                        },
                        {
                          id: 'file',
                          label: tr('editor.propertiesGroupFile'),
                          rows: [
                            row('fileName', tr('editor.propFileName'), item.fileName),
                            row('extension', tr('editor.propExtension'), ext),
                            row('path', tr('editor.propPath'), folderName, item.inputPath),
                            row('size', tr('editor.propSize'), formatFileSize(p.sizeBytes)),
                            row('created', tr('editor.propCreated'), fmtDate(p.createdMs)),
                            row('modified', tr('editor.propModified'), fmtDate(p.modifiedMs)),
                          ].filter(isRow),
                        },
                      ].filter((g) => g.rows.length > 0)
                      return (
                        <div data-testid="properties-readout" className="mt-3 space-y-3">
                          {groups.map((group) => (
                            <div key={group.id}>
                              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                                {group.label}
                              </div>
                              <dl className="overflow-hidden rounded-lg bg-[var(--color-field)]">
                                {group.rows.map((r, i) => (
                                  <div
                                    key={r.id}
                                    data-testid={`property-${r.id}`}
                                    className={`flex items-center justify-between gap-4 px-3 py-2 ${
                                      i > 0 ? 'border-t border-[var(--color-line)]' : ''
                                    }`}
                                  >
                                    <dt className="shrink-0 text-xs text-fg-dim">{r.label}</dt>
                                    <dd className="min-w-0 truncate text-right text-sm font-medium tabular-nums">
                                      {r.id === 'path' ? (
                                        <button
                                          type="button"
                                          data-testid="property-reveal"
                                          onClick={() => window.api.reveal(item.inputPath)}
                                          title={r.full}
                                          className="press inline-flex max-w-full items-center gap-1.5 align-middle text-[var(--color-accent)] hover:underline"
                                        >
                                          <svg
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth={2}
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                            className="h-3.5 w-3.5 shrink-0"
                                          >
                                            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                          </svg>
                                          <span className="truncate">{r.value}</span>
                                        </button>
                                      ) : (
                                        <span title={r.full}>{r.value}</span>
                                      )}
                                    </dd>
                                  </div>
                                ))}
                              </dl>
                            </div>
                          ))}
                        </div>
                      )
                    })()
                  : item.properties === null && (
                      <p className="mt-3 text-xs text-fg-dim">
                        {tr('editor.propertiesUnavailable')}
                      </p>
                    ))}
            </div>
          )}

          {!isMulti && (showSpectrum || showLoudness) && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.qualityTitle')}
                open={spectrumOpen}
                onToggle={() => setSpectrumOpen((v) => !v)}
                right={
                  item.spectrum &&
                  item.spectrum.cutoffHz !== null &&
                  (qualityVerdict(item.spectrum.cutoffHz, item.spectrum.sampleRateHz) === 'good' ? (
                    <span
                      data-testid="quality-badge"
                      className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                    >
                      {tr('editor.qualityGood')}
                    </span>
                  ) : (
                    <span
                      data-testid="quality-badge"
                      className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                    >
                      {tr('editor.qualitySuspect')}
                    </span>
                  ))
                }
              />
              {spectrumOpen && (
                <div className="mt-3">
                  {showSpectrum &&
                    (analyzing ? (
                      <div className="flex h-28 items-center justify-center gap-3 text-xs text-fg-dim">
                        <WaveSpinner />
                        {tr('editor.analyzing')}
                      </div>
                    ) : analyzeError ? (
                      <p className="text-xs text-danger">{analyzeError}</p>
                    ) : item.spectrum ? (
                      <>
                        <Spectrogram spectrum={item.spectrum} />
                        {item.spectrum.cutoffHz !== null && (
                          <p className="mt-2 text-xs text-fg-dim">
                            {tr('editor.qualityCaption', {
                              cutoff: formatKHz(item.spectrum.cutoffHz),
                              nyquist: formatKHz(item.spectrum.sampleRateHz / 2),
                            })}
                          </p>
                        )}
                      </>
                    ) : null)}
                  {showLoudness &&
                    item.loudness &&
                    (() => {
                      const loud = item.loudness
                      // The astats-derived checks each appear only when measured
                      // (null = mono, a dead channel, or an unparseable reading).
                      const cell = (
                        id: string,
                        label: string,
                        value: string,
                        grade: Grade,
                        hint: string,
                      ) => ({ id, label, value, grade, hint })
                      const groups = [
                        {
                          id: 'loudness',
                          label: tr('editor.loudnessGroupLoudness'),
                          cells: [
                            cell(
                              'lufs',
                              tr('editor.loudnessLufsLabel'),
                              `${formatDb(loud.integratedLufs)} LUFS`,
                              gradeLufs(loud.integratedLufs),
                              tr('editor.loudnessLufsHint'),
                            ),
                            cell(
                              'peak',
                              tr('editor.loudnessPeakLabel'),
                              `${formatDb(loud.truePeakDb)} dBTP`,
                              gradeTruePeak(loud.truePeakDb),
                              tr('editor.loudnessPeakHint'),
                            ),
                            cell(
                              'range',
                              tr('editor.loudnessRangeLabel'),
                              `${formatDb(loud.lra)} LU`,
                              gradeLra(loud.lra),
                              tr('editor.loudnessRangeHint'),
                            ),
                            loud.crestDb !== null &&
                              cell(
                                'crest',
                                tr('editor.loudnessCrestLabel'),
                                `${formatDb(loud.crestDb)} dB`,
                                gradeCrest(loud.crestDb),
                                tr('editor.loudnessCrestHint'),
                              ),
                          ].filter((c) => c !== false),
                        },
                        {
                          id: 'signal',
                          label: tr('editor.loudnessGroupSignal'),
                          cells: [
                            loud.channelBalanceDb !== null &&
                              cell(
                                'balance',
                                tr('editor.loudnessBalanceLabel'),
                                `${formatDb(loud.channelBalanceDb)} dB`,
                                gradeBalance(loud.channelBalanceDb),
                                tr('editor.loudnessBalanceHint'),
                              ),
                            loud.dcOffset !== null &&
                              cell(
                                'dc',
                                tr('editor.loudnessDcLabel'),
                                formatPercent(loud.dcOffset),
                                gradeDcOffset(loud.dcOffset),
                                tr('editor.loudnessDcHint'),
                              ),
                            loud.noiseFloorDb !== null &&
                              cell(
                                'noise',
                                tr('editor.loudnessNoiseLabel'),
                                `${formatDb(loud.noiseFloorDb)} dB`,
                                gradeNoiseFloor(loud.noiseFloorDb),
                                tr('editor.loudnessNoiseHint'),
                              ),
                          ].filter((c) => c !== false),
                        },
                      ].filter((g) => g.cells.length > 0)
                      return (
                        <div data-testid="loudness-readout" className="mt-3 space-y-3">
                          {groups.map((group, gi) => (
                            <div key={group.id}>
                              <div className="mb-1.5 flex items-center justify-between">
                                <span className="text-[10px] font-medium uppercase tracking-wider text-fg-dim">
                                  {group.label}
                                </span>
                                {gi === 0 && (
                                  <button
                                    type="button"
                                    data-testid="loudness-help-toggle"
                                    onClick={() => setLoudnessHelpOpen(true)}
                                    className="press group relative flex h-5 w-5 items-center justify-center rounded-full text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth={2}
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    >
                                      <circle cx="12" cy="12" r="10" />
                                      <line x1="12" y1="16" x2="12" y2="12" />
                                      <line x1="12" y1="8" x2="12.01" y2="8" />
                                    </svg>
                                    <Tooltip label={tr('editor.loudnessHelpTitle')} align="end" />
                                  </button>
                                )}
                              </div>
                              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(6.5rem,1fr))]">
                                {group.cells.map((c) => (
                                  <div
                                    key={c.id}
                                    data-testid={`loudness-pill-${c.id}`}
                                    data-grade={c.grade}
                                    className="group relative rounded-lg bg-[var(--color-field)] px-3 py-2"
                                  >
                                    <div className="flex items-center gap-1.5">
                                      <span
                                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${GRADE_DOT[c.grade]}`}
                                      />
                                      <span className="truncate text-[10px] uppercase tracking-wide text-fg-dim">
                                        {c.label}
                                      </span>
                                    </div>
                                    <div
                                      className={`mt-0.5 text-sm font-medium tabular-nums ${GRADE_TEXT[c.grade]}`}
                                    >
                                      {c.value}
                                    </div>
                                    <Tooltip label={c.hint} />
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                </div>
              )}
            </div>
          )}

          {loudnessHelpOpen && <LoudnessHelpModal onClose={() => setLoudnessHelpOpen(false)} />}

          {!isMulti && (
            <div className="mt-6 border-t border-[var(--color-line)] pt-5">
              <SectionHeader
                title={tr('editor.outputName')}
                open={outputOpen}
                onToggle={() => setOutputOpen((v) => !v)}
                right={
                  <button
                    type="button"
                    data-testid="regenerate-output-name"
                    onClick={onOpenRename}
                    className="press group relative flex items-center gap-1.5 rounded-md text-xs text-fg-dim hover:text-fg"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-3 w-3"
                    >
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                    {tr('editor.regenerate')}
                    <Tooltip label={tr('editor.regenerateHint')} align="end" />
                  </button>
                }
              />
              {outputOpen && (
                <label className="relative mt-3 block">
                  <input
                    data-testid="output-name"
                    value={item.outputName ?? defaultOutputName}
                    onChange={(e) => onChange({ outputName: e.target.value })}
                    className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-14 pl-3 text-sm outline-none focus:border-[var(--color-accent)]"
                  />
                  <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-dim">
                    .{format}
                  </span>
                </label>
              )}
              {outputOpen && (
                <p className="mt-2 text-xs text-fg-dim" data-testid="output-name-hint">
                  {willEditInPlace ? (
                    tr('editor.outputNameHintInPlace')
                  ) : (
                    <Trans
                      i18nKey="editor.outputNameHint"
                      components={[
                        <button
                          key="settings"
                          type="button"
                          data-testid="output-name-hint-settings"
                          onClick={() => onOpenSettings('naming')}
                          className="underline underline-offset-2 hover:no-underline"
                        />,
                      ]}
                    />
                  )}
                </p>
              )}
            </div>
          )}

          <div
            data-testid="editor-normalize"
            className="mt-6 border-t border-[var(--color-line)] pt-5"
          >
            <SectionHeader
              title={tr('normalize.title')}
              open={normalizeOpen}
              onToggle={() => setNormalizeOpen((v) => !v)}
              right={
                normalizeCfg.mode !== 'none' ? (
                  <span
                    data-testid="normalize-active-badge"
                    className="rounded-full bg-[var(--color-accent)]/15 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
                  >
                    {tr(`normalize.mode.${normalizeCfg.mode}`)}
                  </span>
                ) : undefined
              }
            />
            {normalizeOpen && (
              <div className="mt-3">
                <p className="mb-3 text-xs text-fg-dim">{tr('normalize.hint')}</p>
                <NormalizeControls
                  value={normalizeCfg}
                  onChange={(n) => {
                    setNormalizeCfg(n)
                    onNormalizeChange?.(n)
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-[var(--color-line)] bg-[var(--color-ink)] px-6 py-3.5">
          {item.status === 'error' && (
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-xs text-danger">{item.error}</p>
              <button
                type="button"
                data-testid="report-error"
                onClick={() => openFeedback(item.error)}
                className="shrink-0 text-xs text-fg-dim underline-offset-2 hover:text-fg hover:underline"
              >
                {tr('editor.reportError')}
              </button>
            </div>
          )}
          <div className="space-y-2">
            {normalizeCfg.mode !== 'none' && (
              <button
                type="button"
                data-testid="convert-normalize-note"
                onClick={() => setNormalizeOpen(true)}
                className="press group relative flex w-full items-center justify-center gap-1.5 text-xs text-[var(--color-accent)] hover:underline"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                >
                  <line x1="4" y1="21" x2="4" y2="14" />
                  <line x1="4" y1="10" x2="4" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12" y2="3" />
                  <line x1="20" y1="21" x2="20" y2="16" />
                  <line x1="20" y1="12" x2="20" y2="3" />
                  <line x1="1" y1="14" x2="7" y2="14" />
                  <line x1="9" y1="8" x2="15" y2="8" />
                  <line x1="17" y1="16" x2="23" y2="16" />
                </svg>
                {tr(`normalize.mode.${normalizeCfg.mode}`)} ·{' '}
                {normalizeCfg.mode === 'loudness'
                  ? `${normalizeCfg.targetLufs} LUFS`
                  : `${normalizeCfg.peakDb} dBFS`}
                <Tooltip label={tr('normalize.title')} />
              </button>
            )}
            {showDone ? (
              // A finished export led with four equal buttons, the loudest of which
              // (re-export) is the rarest next step. Now the outcome line confirms
              // the write and a single primary "Show file" carries the likely next
              // action; re-export and Apple Music drop to a quiet row, and trashing
              // the original — destructive and rare — is a plain link at the bottom.
              <>
                <p
                  data-testid="export-success"
                  className="text-center text-xs font-medium text-good"
                >
                  {isMulti
                    ? tr('editor.exportedCount', { count: multiTracks.length })
                    : tr('editor.exportedAs', { format: (exportedFormat ?? '').toUpperCase() })}
                </p>
                <button
                  type="button"
                  data-testid="show-file"
                  onClick={() => revealPath && window.api.reveal(revealPath)}
                  className="press w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
                >
                  {tr('editor.showFile')}
                </button>
                <div className="flex gap-2">
                  {window.api.platform === 'darwin' && musicExt !== 'flac' && (
                    <button
                      type="button"
                      data-testid="add-apple-music"
                      onClick={isMulti ? onAddAllToAppleMusic : onAddToAppleMusic}
                      disabled={musicAdding || musicAdded}
                      className="press flex-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-60 disabled:hover:bg-[var(--color-panel-2)]"
                    >
                      {musicAdding
                        ? tr('editor.appleMusicAdding')
                        : musicAdded
                          ? tr('editor.appleMusicAdded')
                          : tr('editor.appleMusicAdd')}
                    </button>
                  )}
                  <ExportButton
                    quiet
                    status={isMulti ? 'idle' : item.status}
                    stale={false}
                    done={false}
                    outputFormat={format}
                    exportedFormat={isMulti ? null : exportedFormat}
                    withAppleMusic={false}
                    incomplete={false}
                    inPlace={false}
                    count={isMulti ? (selectedTracks?.length ?? 0) : undefined}
                    onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
                    onSelectFormat={(f) => {
                      setFormat(f)
                      onFormatChange?.(f)
                    }}
                  />
                </div>
                {canDeleteOriginal && (
                  <button
                    type="button"
                    data-testid="delete-original"
                    onClick={onTrashOriginal}
                    className="press mx-auto block text-xs text-fg-dim hover:text-danger"
                  >
                    {tr('editor.deleteOriginal')}
                  </button>
                )}
                {musicError && <p className="text-xs text-danger">{musicError}</p>}
              </>
            ) : (
              <ExportButton
                status={isMulti ? 'idle' : item.status}
                stale={!isMulti && stale}
                done={!isMulti && done}
                outputFormat={format}
                exportedFormat={isMulti ? null : exportedFormat}
                withAppleMusic={
                  window.api.platform === 'darwin' && format !== 'flac' && addToAppleMusic
                }
                incomplete={!isMulti && incomplete}
                inPlace={!isMulti && willEditInPlace}
                count={isMulti ? (selectedTracks?.length ?? 0) : undefined}
                onProcess={isMulti ? (f) => onProcessAll?.(f) : onProcess}
                onSelectFormat={(f) => {
                  setFormat(f)
                  onFormatChange?.(f)
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

interface ExportButtonProps {
  status: TrackItem['status']
  stale: boolean
  done: boolean
  outputFormat: OutputFormat
  exportedFormat: OutputFormat | null
  withAppleMusic: boolean
  incomplete: boolean
  // True when the chosen format is the source's own: the export edits the original in
  // place and renames it rather than writing a converted copy, so the button offers to
  // "Update" instead of promising a conversion.
  inPlace: boolean
  // When set, the button converts the whole selection in the chosen format and labels
  // itself "Convert all (N)" instead of the single-track convert; the format menu works
  // the same, it just applies to every selected track.
  count?: number
  // The demoted variant shown after a successful export: a bordered, muted control
  // that sits in the secondary row labelled "Re-export", rather than the prominent
  // accent button used to convert.
  quiet?: boolean
  onProcess: (format: OutputFormat) => void
  onSelectFormat: (format: OutputFormat) => void
}

// A split button: the body exports in the currently chosen format (seeded from
// Settings), the chevron opens a menu to switch which format that is. Picking a
// format only relabels the button — it never converts on the spot, so a misclick
// can't write a file; the deliberate click on the body is what exports. The control
// stays visible after a track is done so re-exporting to another format never
// means reloading the file or touching Settings.
function ExportButton({
  status,
  stale,
  done,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  incomplete,
  inPlace,
  count,
  quiet,
  onProcess,
  onSelectFormat,
}: ExportButtonProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const processing = status === 'processing'
  // A track missing required tags cannot be converted, so the gate covers the
  // main action and the format menu alike.
  const blocked = processing || incomplete

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const label = processing
    ? tr('editor.processing')
    : quiet
      ? tr('editor.reexport')
      : count !== undefined
        ? tr(withAppleMusic ? 'editor.convertAllMusic' : 'editor.convertAll', {
            count,
            format: outputFormat.toUpperCase(),
          })
        : inPlace
          ? tr(withAppleMusic ? 'editor.updateMusic' : 'editor.update')
          : stale
            ? tr('editor.update')
            : done
              ? tr('editor.exportAgain')
              : tr(withAppleMusic ? 'editor.convert' : 'editor.convertNoMusic', {
                  format: outputFormat.toUpperCase(),
                })

  function pick(format: OutputFormat): void {
    setOpen(false)
    onSelectFormat(format)
  }

  return (
    <div ref={ref} className={`relative flex ${quiet ? 'flex-1' : ''}`}>
      <button
        type="button"
        data-testid="process-btn"
        onClick={() => onProcess(outputFormat)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex-1 rounded-l-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2 text-xs font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-50'
            : 'press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
        }
      >
        {label}
      </button>
      <button
        type="button"
        data-testid="process-format-toggle"
        aria-label={tr('editor.chooseFormat')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={blocked}
        className={
          quiet
            ? 'press flex w-9 items-center justify-center rounded-r-lg border border-l-0 border-[var(--color-line-strong)] bg-[var(--color-panel-2)] hover:bg-[var(--color-line-strong)] disabled:opacity-50'
            : 'press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
        }
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path
            d="m2.5 4.5 3.5 3.5 3.5-3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-2 w-56 overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-lg">
          {FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`process-format-${id}`}
              aria-current={id === outputFormat ? 'true' : undefined}
              onClick={() => pick(id)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] ${
                id === outputFormat ? 'font-medium text-[var(--color-accent)]' : ''
              }`}
            >
              {tr(`settings.formats.${id}`)}
              {id === exportedFormat && (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-3.5 w-3.5 text-good"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CollapsibleTracks({
  open,
  children,
}: {
  open: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const lastContent = useRef<React.ReactNode>(null)
  if (open && children) lastContent.current = children
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-200 ease-out ${
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
      }`}
    >
      <div
        className={`overflow-hidden transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {open ? children : lastContent.current}
      </div>
    </div>
  )
}

function TrackSkeleton(): React.JSX.Element {
  const widths = ['62%', '48%', '70%']
  return (
    <div className="animate-pulse" aria-hidden="true">
      {widths.map((w) => (
        <div key={w} className="flex items-center gap-3 py-1.5 pr-3 pl-4">
          <span className="h-3 w-6 shrink-0 rounded bg-[var(--color-panel-2)]" />
          <span className="h-3 rounded bg-[var(--color-panel-2)]" style={{ width: w }} />
        </div>
      ))}
    </div>
  )
}

interface SectionHeaderProps {
  title: string
  open: boolean
  onToggle: () => void
  right?: React.ReactNode
}

function SectionHeader({ title, open, onToggle, right }: SectionHeaderProps): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-fg-dim hover:text-fg-muted"
      >
        <svg
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <path
            d="m4.5 2.5 3.5 3.5-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {title}
      </button>
      {right}
    </div>
  )
}

// A 0–5 star picker. Clicking a star sets that many; clicking the highest filled
// star again clears the rating (back to none). Value is the "1"–"5"/"" string the
// rest of the app stores; the write path turns it into the Traktor POPM byte.
function StarRating({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const stars = Number(value) || 0
  return (
    <span data-testid="star-rating" className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= stars
        return (
          <button
            key={n}
            type="button"
            data-testid={`star-${n}`}
            aria-pressed={filled}
            aria-label={tr('editor.ratingStars', { count: n })}
            onClick={() => onChange(n === stars ? '' : String(n))}
            className={`press ${filled ? 'text-warn' : 'text-fg-faint hover:text-fg-dim'}`}
          >
            <svg
              viewBox="0 0 24 24"
              fill={filled ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 18.9 6.2 20.9l1.1-6.5L2.6 9.3l6.5-.9z" />
            </svg>
          </button>
        )
      })}
    </span>
  )
}

interface FieldProps {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
  invalid?: boolean
  placeholder?: string
  suggestions?: string[]
  multiSuggestions?: boolean
}

function Field({
  name,
  label,
  value,
  onChange,
  wide,
  invalid,
  placeholder,
  suggestions,
  multiSuggestions,
}: FieldProps): React.JSX.Element {
  return (
    <label className={`block ${wide ? 'col-span-1 @[26rem]:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-fg-dim">{label}</span>
      <input
        data-testid={`field-${name}`}
        aria-invalid={invalid}
        title={value}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border bg-[var(--color-field)] px-3 py-2 text-sm outline-none ${
          invalid
            ? 'border-danger focus:border-danger'
            : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
        }`}
      />
      {suggestions && suggestions.length > 0 && (
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          {suggestions.map((s) => {
            const on = multiSuggestions ? csvHas(value, s) : value === s
            return (
              <button
                key={s}
                type="button"
                data-testid={`chip-${s}`}
                onClick={() => onChange(multiSuggestions ? toggleCsv(value, s) : on ? '' : s)}
                className={`press rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                  on
                    ? 'border-transparent bg-[var(--color-accent)] text-white'
                    : 'border-[var(--color-line-strong)] text-fg-muted hover:bg-[var(--color-panel-2)]'
                }`}
              >
                {s}
              </button>
            )
          })}
        </span>
      )}
    </label>
  )
}
