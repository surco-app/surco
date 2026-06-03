import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type {
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsTrack,
  OutputFormat,
} from '../../../shared/types'
import { csvHas, toggleCsv } from '../lib/csv'
import { openFeedback } from '../lib/feedback'
import { FIELD_DEFS } from '../lib/fields'
import { splitPosition } from '../lib/position'
import { genrePresets } from '../lib/genre'
import { renderOutputName } from '../lib/outputName'
import { formatKHz, qualityVerdict } from '../lib/quality'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'
import { ResizeHandle, useResizableWidth } from './ResizeHandle'
import { Spectrogram } from './Spectrogram'
import { WaveSpinner } from './WaveSpinner'

interface Props {
  item: TrackItem
  hasToken: boolean
  outputFormat: OutputFormat
  filenameFormat: string
  groupingPresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: () => void
  onOpenSettings: () => void
}

function cleanName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '')
}

function joinArtists(artists?: { name: string }[]): string {
  return (artists ?? []).map((a) => cleanName(a.name)).join(', ')
}

function coverOf(release: DiscogsRelease, fallback?: string): string | undefined {
  return (
    release.images?.find((i) => i.type === 'primary')?.uri ?? release.images?.[0]?.uri ?? fallback
  )
}

// A release fetched by id has no search-result row to show, so synthesise one
// from the release itself — the list and tracklist UI then work unchanged.
function resultFromRelease(rel: DiscogsRelease): DiscogsSearchResult {
  const albumArtist = joinArtists(rel.artists)
  return {
    id: rel.id,
    title: albumArtist ? `${albumArtist} - ${rel.title}` : rel.title,
    year: rel.year ? String(rel.year) : undefined,
    thumb: coverOf(rel),
    label: rel.labels?.map((l) => l.name),
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Mirrors Meta's "Match Tracks: Automatically": picks the tracklist entry whose
// title best matches the title parsed from the file name, so the right mix
// (e.g. "Beeper's Mix") is preselected instead of the user hunting for it.
function bestTrack(tracks: DiscogsTrack[], title: string): DiscogsTrack | undefined {
  const target = normalize(title)
  if (!target) return undefined
  const targetWords = new Set(target.split(' '))
  let best: DiscogsTrack | undefined
  let bestScore = 0
  for (const t of tracks) {
    const nt = normalize(t.title)
    if (!nt) continue
    let score: number
    if (nt === target) score = 1000
    else if (target.includes(nt) || nt.includes(target))
      score = 500 + Math.min(nt.length, target.length)
    else score = nt.split(' ').filter((w) => targetWords.has(w)).length
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return bestScore > 0 ? best : undefined
}

export function Editor({
  item,
  hasToken,
  outputFormat,
  filenameFormat,
  groupingPresets,
  visibleFields,
  requiredFields,
  searchInputRef,
  onChange,
  onProcess,
  onOpenSettings,
}: Props): React.JSX.Element {
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
  const [spectrumOpen, setSpectrumOpen] = useState(true)
  const [inLibrary, setInLibrary] = useState<'idle' | 'yes' | 'no'>('idle')
  const releaseRef = useRef<DiscogsRelease | null>(null)
  const discogs = useResizableWidth(400, 320, 720)

  async function doSearch(): Promise<void> {
    if (!query.trim()) return
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
        setResults(await window.api.searchDiscogs(query))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.searchError'))
    } finally {
      setBusy(false)
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: must depend on the query value, not doSearch's identity — with doSearch the effect re-ran every render and looped search requests until Discogs returned 429. Debounced so a search fires once, 500ms after typing stops.
  useEffect(() => {
    if (!hasToken || !query.trim()) return
    const id = setTimeout(() => void doSearch(), 500)
    return () => clearTimeout(id)
  }, [hasToken, query])

  // biome-ignore lint/correctness/useExhaustiveDependencies: must analyze once per input, not on onChange/tr/spectrum identity — depending on those restarted analysis mid-flight, and a superseded run's cleanup left the spinner stranded (its finally never ran). The Editor remounts per track (key={track.id}), so keying on inputPath runs it exactly once.
  useEffect(() => {
    if (item.spectrum) return
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
  }, [item.inputPath])

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

  // Applying a release overwrites the whole right-hand panel — album-level data
  // and cover from the release, plus the chosen track's title/number/artist — so
  // the song ends up fully tagged from Discogs in one action.
  function commitMeta(
    rel: DiscogsRelease,
    track: DiscogsTrack | undefined,
    coverFallback?: string,
  ): void {
    const albumArtist = joinArtists(rel.artists)
    const genre = (rel.styles?.length ? rel.styles : (rel.genres ?? []))[0] ?? ''
    const trackArtist = joinArtists(track?.artists)
    const label = rel.labels?.[0]
    const publisher = label?.name?.trim() ?? ''
    const catno = label?.catno?.trim() ?? ''
    const catalogNumber = catno && catno.toLowerCase() !== 'none' ? catno : ''
    const pos = track ? splitPosition(track.position) : undefined
    onChange({
      coverUrl: coverOf(rel, coverFallback),
      coverPath: undefined,
      meta: {
        ...item.meta,
        title: track ? track.title : item.meta.title,
        trackNumber: pos ? pos.track : item.meta.trackNumber,
        discNumber: pos ? pos.disc : item.meta.discNumber,
        album: rel.title,
        albumArtist,
        artist: trackArtist || item.meta.artist || albumArtist,
        year: rel.year ? String(rel.year) : item.meta.year,
        genre,
        publisher: publisher || item.meta.publisher,
        catalogNumber: catalogNumber || item.meta.catalogNumber,
      },
    })
  }

  async function applyRelease(result: DiscogsSearchResult): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const rel = await loadRelease(result.id)
      setRelease(rel)
      commitMeta(rel, bestTrack(rel.tracklist, item.meta.title), result.cover_image)
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.releaseError'))
    } finally {
      setBusy(false)
    }
  }

  function selectTrack(track: DiscogsTrack): void {
    if (release) commitMeta(release, track, item.coverUrl)
  }

  function setField(key: keyof TrackItem['meta'], value: string): void {
    onChange({ meta: { ...item.meta, [key]: value } })
  }

  function onCoverDrop(e: React.DragEvent): void {
    e.preventDefault()
    e.stopPropagation()
    setCoverDragging(false)
    const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    onChange({ coverUrl: URL.createObjectURL(file), coverPath: window.api.getPathForFile(file) })
  }

  const done = item.status === 'done'
  const showRequiredErrors = item.status === 'error'
  const genreChips = genrePresets(release)
  const defaultOutputName = renderOutputName(filenameFormat, item.meta) || item.fileName

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
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              data-testid="discogs-search"
              onClick={doSearch}
              disabled={busy || !hasToken}
              className="press rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
            >
              {tr('editor.search')}
            </button>
          </div>
          {!hasToken && (
            <p className="mt-2 text-xs text-warn">
              <Trans
                i18nKey="editor.tokenWarning"
                components={[
                  <button
                    key="settings"
                    type="button"
                    onClick={onOpenSettings}
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
                    data-testid="discogs-result"
                    title={tr('editor.resultHint')}
                    aria-expanded={expanded}
                    onClick={() => previewRelease(r)}
                    onDoubleClick={() => applyRelease(r)}
                    className={`flex w-full items-center gap-3 p-2.5 text-left hover:bg-[var(--color-panel-2)] ${
                      expanded ? 'bg-[var(--color-accent-soft)]' : ''
                    }`}
                  >
                    {r.thumb ? (
                      <img
                        src={r.thumb}
                        alt=""
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
                  </button>
                  <CollapsibleTracks open={expanded}>
                    <div className="pb-1">
                      <p className="px-3 pt-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-fg-faint">
                        {tr('editor.chooseTrack')}
                      </p>
                      {loaded && release ? (
                        release.tracklist.map((t, i) => (
                          <button
                            key={`${t.position}-${i}`}
                            data-testid="discogs-track"
                            onClick={() => selectTrack(t)}
                            className={`flex w-full items-center gap-3 py-1.5 pr-3 pl-4 text-left hover:bg-[var(--color-panel-2)] ${
                              t.title === item.meta.title ? 'bg-[var(--color-accent-soft)]' : ''
                            }`}
                          >
                            <span className="w-8 shrink-0 text-xs tabular-nums text-fg-dim">
                              {t.position}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                          </button>
                        ))
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
            title={tr('editor.sectionForm')}
            open={formOpen}
            onToggle={() => setFormOpen((v) => !v)}
            right={
              inLibrary === 'yes' ? (
                <span
                  data-testid="apple-music-status"
                  className="rounded-full bg-warn/15 px-2.5 py-1 text-xs font-medium text-warn"
                >
                  {tr('editor.inLibrary')}
                </span>
              ) : inLibrary === 'no' ? (
                <span
                  data-testid="apple-music-status"
                  className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good"
                >
                  {tr('editor.notInLibrary')}
                </span>
              ) : null
            }
          />
          {formOpen && (
            <div className="mt-4">
              <div className="flex gap-6">
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
                  className="shrink-0"
                  title={tr('editor.coverTitle')}
                >
                  {item.coverUrl ? (
                    <img
                      data-testid="cover-preview"
                      src={item.coverUrl}
                      alt={tr('editor.coverAlt')}
                      className={`h-44 w-44 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10 ${
                        coverDragging ? 'ring-2 ring-[var(--color-accent)]' : ''
                      }`}
                    />
                  ) : (
                    <div
                      className={`flex h-44 w-44 items-center justify-center rounded-xl border border-dashed text-xs ${
                        coverDragging
                          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                          : 'border-[var(--color-line)] text-fg-faint'
                      }`}
                    >
                      {coverDragging ? tr('editor.coverDropActive') : tr('editor.coverDrop')}
                    </div>
                  )}
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3">
                  {visibleFields.map((key) => {
                    const def = FIELD_DEFS.find((d) => d.key === key)
                    if (!def) return null
                    return (
                      <Field
                        key={def.key}
                        name={def.key}
                        label={tr(`fields.${def.key}`)}
                        value={item.meta[def.key]}
                        onChange={(v) => setField(def.key, v)}
                        wide={def.wide}
                        invalid={
                          showRequiredErrors &&
                          requiredFields.includes(def.key) &&
                          !item.meta[def.key].trim()
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
                {analyzing ? (
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
                ) : null}
              </div>
            )}
          </div>

          <label className="mt-6 block border-t border-[var(--color-line)] pt-5">
            <span className="mb-1 block text-xs font-medium text-fg-dim">
              {tr('editor.outputName')}
            </span>
            <div className="relative">
              <input
                data-testid="output-name"
                value={item.outputName ?? defaultOutputName}
                onChange={(e) => onChange({ outputName: e.target.value })}
                className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-field)] py-2 pr-14 pl-3 text-sm outline-none focus:border-[var(--color-accent)]"
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-fg-dim">
                .{outputFormat}
              </span>
            </div>
          </label>
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
          {done ? (
            <button
              onClick={() => item.outputPath && window.api.reveal(item.outputPath)}
              className="press w-full rounded-lg border border-good/40 bg-good/10 py-2.5 text-sm font-medium text-good hover:bg-good/15"
            >
              {tr('editor.doneReveal')}
            </button>
          ) : (
            <button
              data-testid="process-btn"
              onClick={onProcess}
              disabled={item.status === 'processing'}
              className="press w-full rounded-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {item.status === 'processing'
                ? tr('editor.processing')
                : tr(window.api.platform === 'darwin' ? 'editor.convert' : 'editor.convertNoMusic', {
                    format: outputFormat.toUpperCase(),
                  })}
            </button>
          )}
        </div>
      </div>
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

interface FieldProps {
  name: string
  label: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
  invalid?: boolean
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
  suggestions,
  multiSuggestions,
}: FieldProps): React.JSX.Element {
  return (
    <label className={`block ${wide ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-fg-dim">{label}</span>
      <input
        data-testid={`field-${name}`}
        aria-invalid={invalid}
        title={value}
        value={value}
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
                className={`press rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
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
