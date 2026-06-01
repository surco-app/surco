import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DiscogsSearchResult, DiscogsRelease, DiscogsTrack } from '../../../shared/types'
import type { TrackItem } from '../types'
import { genrePresets } from '../lib/genre'
import { renderOutputName } from '../lib/outputName'
import { qualityVerdict, formatKHz } from '../lib/quality'
import { FIELD_DEFS } from '../lib/fields'
import { WaveSpinner } from './WaveSpinner'
import { Spectrogram } from './Spectrogram'

interface Props {
  item: TrackItem
  hasToken: boolean
  filenameFormat: string
  groupingPresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: () => void
}

function cleanName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '')
}

function joinArtists(artists?: { name: string }[]): string {
  return (artists ?? []).map((a) => cleanName(a.name)).join(', ')
}

function coverOf(release: DiscogsRelease, fallback?: string): string | undefined {
  return release.images?.find((i) => i.type === 'primary')?.uri ?? release.images?.[0]?.uri ?? fallback
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
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
    else if (target.includes(nt) || nt.includes(target)) score = 500 + Math.min(nt.length, target.length)
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
  filenameFormat,
  groupingPresets,
  visibleFields,
  requiredFields,
  searchInputRef,
  onChange,
  onProcess
}: Props): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [query, setQuery] = useState(item.query)
  const [results, setResults] = useState<DiscogsSearchResult[]>([])
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [coverDragging, setCoverDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')
  const releaseRef = useRef<DiscogsRelease | null>(null)

  async function doSearch(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setError('')
    setRelease(null)
    try {
      setResults(await window.api.searchDiscogs(query))
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.searchError'))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (hasToken && query.trim()) void doSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (item.spectrum) return
    let active = true
    setAnalyzing(true)
    setAnalyzeError('')
    window.api
      .spectrogram(item.inputPath)
      .then((res) => onChange({ spectrum: res }))
      .catch((e) => {
        if (active) setAnalyzeError(e instanceof Error ? e.message : tr('editor.analyzeError'))
      })
      .finally(() => {
        if (active) setAnalyzing(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    setBusy(true)
    setError('')
    try {
      setRelease(await loadRelease(result.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : tr('editor.releaseError'))
    } finally {
      setBusy(false)
    }
  }

  // Applying a release overwrites the whole right-hand panel — album-level data
  // and cover from the release, plus the chosen track's title/number/artist — so
  // the song ends up fully tagged from Discogs in one action.
  function commitMeta(rel: DiscogsRelease, track: DiscogsTrack | undefined, coverFallback?: string): void {
    const albumArtist = joinArtists(rel.artists)
    const genre = (rel.styles?.length ? rel.styles : (rel.genres ?? [])).join(', ')
    const trackArtist = joinArtists(track?.artists)
    onChange({
      coverUrl: coverOf(rel, coverFallback),
      coverPath: undefined,
      meta: {
        ...item.meta,
        title: track ? track.title : item.meta.title,
        trackNumber: track ? track.position.replace(/\D/g, '') : item.meta.trackNumber,
        album: rel.title,
        albumArtist,
        artist: trackArtist || item.meta.artist || albumArtist,
        year: rel.year ? String(rel.year) : item.meta.year,
        genre
      }
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

  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-[500px] shrink-0 flex-col border-r border-[var(--color-line)]">
        <div className="border-b border-[var(--color-line)] p-3">
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              data-testid="discogs-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder={tr('editor.searchPlaceholder')}
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              data-testid="discogs-search"
              onClick={doSearch}
              disabled={busy || !hasToken}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              {tr('editor.search')}
            </button>
          </div>
          {!hasToken && (
            <p className="mt-2 text-xs text-amber-400">{tr('editor.tokenWarning')}</p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="min-h-0 w-[240px] shrink-0 overflow-y-auto border-r border-[var(--color-line)]">
            {results.map((r) => (
              <button
                key={r.id}
                data-testid="discogs-result"
                title={tr('editor.resultHint')}
                onClick={() => previewRelease(r)}
                onDoubleClick={() => applyRelease(r)}
                className={`flex w-full items-center gap-3 border-b border-[var(--color-line)]/50 p-2.5 text-left hover:bg-[var(--color-panel-2)] ${
                  release?.id === r.id ? 'bg-[var(--color-accent-soft)]' : ''
                }`}
              >
                {r.thumb ? (
                  <img src={r.thumb} alt="" className="h-11 w-11 shrink-0 rounded object-cover" />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded bg-[var(--color-panel-2)]" />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm">{r.title}</span>
                  <span className="block truncate text-xs text-neutral-500">
                    {[r.year, r.label?.[0], r.format?.join(', ')].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <p className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-neutral-500">
              {tr('editor.chooseTrack')}
            </p>
            {release ? (
              release.tracklist.map((t, i) => (
                <button
                  key={`${t.position}-${i}`}
                  data-testid="discogs-track"
                  onClick={() => selectTrack(t)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--color-panel-2)] ${
                    t.title === item.meta.title ? 'bg-[var(--color-accent-soft)]' : ''
                  }`}
                >
                  <span className="w-8 shrink-0 text-xs text-neutral-500">{t.position}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                </button>
              ))
            ) : (
              <p className="px-3 pt-2 text-xs text-neutral-600">{tr('editor.chooseAlbumHint')}</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
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
                  className={`h-44 w-44 rounded-xl object-cover shadow-[0_0_0_1px_rgba(255,255,255,0.08)] ${
                    coverDragging ? 'ring-2 ring-[var(--color-accent)]' : ''
                  }`}
                />
              ) : (
                <div
                  className={`flex h-44 w-44 items-center justify-center rounded-xl border border-dashed text-xs ${
                    coverDragging
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-[var(--color-line)] text-neutral-600'
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
                  />
                )
              })}
            </div>
          </div>

          <div className="mt-6 space-y-2.5 border-t border-[var(--color-line)] pt-5">
            {genreChips.length > 0 && (
              <ChipRow
                label={tr('fields.genre')}
                presets={genreChips}
                active={item.meta.genre}
                onPick={(v) => setField('genre', v)}
              />
            )}
            {groupingPresets.length > 0 && (
              <ChipRow
                label={tr('fields.grouping')}
                presets={groupingPresets}
                active={item.meta.grouping}
                onPick={(v) => setField('grouping', v)}
              />
            )}
          </div>

          <div className="mt-6 border-t border-[var(--color-line)] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                {tr('editor.qualityTitle')}
              </span>
              {item.spectrum &&
                (qualityVerdict(item.spectrum.cutoffHz, item.spectrum.sampleRateHz) === 'good' ? (
                  <span
                    data-testid="quality-badge"
                    className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300"
                  >
                    {tr('editor.qualityGood')}
                  </span>
                ) : (
                  <span
                    data-testid="quality-badge"
                    className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300"
                  >
                    {tr('editor.qualitySuspect')}
                  </span>
                ))}
            </div>
            {analyzing ? (
              <div className="flex h-28 items-center justify-center gap-3 text-xs text-neutral-500">
                <WaveSpinner />
                {tr('editor.analyzing')}
              </div>
            ) : analyzeError ? (
              <p className="text-xs text-red-400">{analyzeError}</p>
            ) : item.spectrum ? (
              <>
                <Spectrogram spectrum={item.spectrum} />
                <p className="mt-2 text-xs text-neutral-500">
                  {tr('editor.qualityCaption', {
                    cutoff: formatKHz(item.spectrum.cutoffHz),
                    nyquist: formatKHz(item.spectrum.sampleRateHz / 2)
                  })}
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] p-4">
          <div className="min-w-0 text-xs text-neutral-500">
            <span className="text-neutral-400">{tr('editor.output')}</span>{' '}
            <span className="truncate">
              {(renderOutputName(filenameFormat, item.meta) || item.fileName) + '.aiff'}
            </span>
            {item.status === 'error' && <p className="mt-1 text-red-400">{item.error}</p>}
          </div>
          {done ? (
            <button
              onClick={() => item.outputPath && window.api.reveal(item.outputPath)}
              className="shrink-0 rounded-lg border border-emerald-500/40 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/10"
            >
              {tr('editor.doneReveal')}
            </button>
          ) : (
            <button
              data-testid="process-btn"
              onClick={onProcess}
              disabled={item.status === 'processing'}
              className="shrink-0 rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              {item.status === 'processing' ? tr('editor.processing') : tr('editor.convert')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface ChipRowProps {
  label: string
  presets: string[]
  active: string
  onPick: (value: string) => void
}

function ChipRow({ label, presets, active, onPick }: ChipRowProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs font-medium text-neutral-500">{label}</span>
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => {
          const on = active === p
          return (
            <button
              key={p}
              data-testid={`chip-${p}`}
              onClick={() => onPick(on ? '' : p)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                on
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)] text-white'
                  : 'border-[var(--color-line)] text-neutral-300 hover:bg-[var(--color-panel-2)]'
              }`}
            >
              {p}
            </button>
          )
        })}
      </div>
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
}

function Field({ name, label, value, onChange, wide, invalid }: FieldProps): React.JSX.Element {
  return (
    <label className={`block ${wide ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      <input
        data-testid={`field-${name}`}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-lg border bg-[var(--color-ink)] px-3 py-2 text-sm outline-none ${
          invalid
            ? 'border-red-500 focus:border-red-500'
            : 'border-[var(--color-line)] focus:border-[var(--color-accent)]'
        }`}
      />
    </label>
  )
}
