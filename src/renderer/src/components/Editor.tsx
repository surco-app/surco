import type React from 'react'
import { useEffect, useState } from 'react'
import type { DiscogsSearchResult, DiscogsRelease, DiscogsTrack } from '../../../shared/types'
import type { TrackItem } from '../types'
import { genrePresets } from '../lib/genre'
import { renderOutputName } from '../lib/outputName'
import { qualityVerdict, formatKHz } from '../lib/quality'
import { WaveSpinner } from './WaveSpinner'

interface Props {
  item: TrackItem
  hasToken: boolean
  filenameFormat: string
  groupingPresets: string[]
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
  searchInputRef,
  onChange,
  onProcess
}: Props): React.JSX.Element {
  const [query, setQuery] = useState(item.query)
  const [results, setResults] = useState<DiscogsSearchResult[]>([])
  const [release, setRelease] = useState<DiscogsRelease | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [coverDragging, setCoverDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState('')

  async function doSearch(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    setError('')
    setRelease(null)
    try {
      setResults(await window.api.searchDiscogs(query))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en la búsqueda')
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
        if (active) setAnalyzeError(e instanceof Error ? e.message : 'No se pudo analizar el audio')
      })
      .finally(() => {
        if (active) setAnalyzing(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function pickRelease(result: DiscogsSearchResult): Promise<void> {
    setBusy(true)
    setError('')
    try {
      const rel = await window.api.getRelease(result.id)
      setRelease(rel)
      const albumArtist = joinArtists(rel.artists)
      const genre = (rel.styles?.length ? rel.styles : (rel.genres ?? [])).join(', ')
      const match = bestTrack(rel.tracklist, item.meta.title)
      const matchArtist = joinArtists(match?.artists)
      onChange({
        coverUrl: coverOf(rel, result.cover_image),
        coverPath: undefined,
        meta: {
          ...item.meta,
          title: match ? match.title : item.meta.title,
          trackNumber: match ? match.position.replace(/\D/g, '') : item.meta.trackNumber,
          album: rel.title,
          albumArtist,
          artist: matchArtist || item.meta.artist || albumArtist,
          year: rel.year ? String(rel.year) : item.meta.year,
          genre
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el release')
    } finally {
      setBusy(false)
    }
  }

  function selectTrack(track: DiscogsTrack): void {
    const trackArtist = joinArtists(track.artists)
    onChange({
      meta: {
        ...item.meta,
        title: track.title,
        trackNumber: track.position.replace(/\D/g, ''),
        artist: trackArtist || item.meta.artist
      }
    })
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
  const genreChips = genrePresets(release)

  return (
    <div className="flex h-full min-h-0">
      <div
        className={`flex shrink-0 flex-col border-r border-[var(--color-line)] ${
          release ? 'w-[500px]' : 'w-[320px]'
        }`}
      >
        <div className="border-b border-[var(--color-line)] p-3">
          <div className="flex gap-2">
            <input
              ref={searchInputRef}
              data-testid="discogs-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && doSearch()}
              placeholder="Buscar en Discogs…"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            <button
              data-testid="discogs-search"
              onClick={doSearch}
              disabled={busy || !hasToken}
              className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-40"
            >
              Buscar
            </button>
          </div>
          {!hasToken && (
            <p className="mt-2 text-xs text-amber-400">
              Configura tu token de Discogs en Ajustes para buscar.
            </p>
          )}
          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex min-h-0 flex-1">
          <div
            className={`min-h-0 overflow-y-auto ${
              release ? 'w-[240px] border-r border-[var(--color-line)]' : 'flex-1'
            }`}
          >
            {results.map((r) => (
              <button
                key={r.id}
                data-testid="discogs-result"
                onClick={() => pickRelease(r)}
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

          {release && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <p className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-neutral-500">
                Elige la pista
              </p>
              {release.tracklist.map((t, i) => (
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
              ))}
            </div>
          )}
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
              title="Arrastra una imagen para usarla como carátula"
            >
              {item.coverUrl ? (
                <img
                  data-testid="cover-preview"
                  src={item.coverUrl}
                  alt="Carátula"
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
                  {coverDragging ? 'Suelta la imagen' : 'Arrastra una carátula'}
                </div>
              )}
            </div>

            <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Título" value={item.meta.title} onChange={(v) => setField('title', v)} wide />
              <Field label="Artista" value={item.meta.artist} onChange={(v) => setField('artist', v)} />
              <Field
                label="Artista del álbum"
                value={item.meta.albumArtist}
                onChange={(v) => setField('albumArtist', v)}
              />
              <Field label="Álbum" value={item.meta.album} onChange={(v) => setField('album', v)} />
              <Field label="Año" value={item.meta.year} onChange={(v) => setField('year', v)} />
              <Field label="Género" value={item.meta.genre} onChange={(v) => setField('genre', v)} />
              <Field
                label="Grouping"
                value={item.meta.grouping}
                onChange={(v) => setField('grouping', v)}
              />
              <Field
                label="Nº pista"
                value={item.meta.trackNumber}
                onChange={(v) => setField('trackNumber', v)}
              />
              <Field
                label="Comentario"
                value={item.meta.comment}
                onChange={(v) => setField('comment', v)}
                wide
              />
            </div>
          </div>

          <div className="mt-6 space-y-2.5 border-t border-[var(--color-line)] pt-5">
            {genreChips.length > 0 && (
              <ChipRow
                label="Género"
                presets={genreChips}
                active={item.meta.genre}
                onPick={(v) => setField('genre', v)}
              />
            )}
            {groupingPresets.length > 0 && (
              <ChipRow
                label="Grouping"
                presets={groupingPresets}
                active={item.meta.grouping}
                onPick={(v) => setField('grouping', v)}
              />
            )}
          </div>

          <div className="mt-6 border-t border-[var(--color-line)] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Calidad de audio
              </span>
              {item.spectrum &&
                (qualityVerdict(item.spectrum.cutoffHz, item.spectrum.sampleRateHz) === 'good' ? (
                  <span
                    data-testid="quality-badge"
                    className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-300"
                  >
                    Buena calidad
                  </span>
                ) : (
                  <span
                    data-testid="quality-badge"
                    className="rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-300"
                  >
                    Sospechoso
                  </span>
                ))}
            </div>
            {analyzing ? (
              <div className="flex h-28 items-center justify-center gap-3 text-xs text-neutral-500">
                <WaveSpinner />
                Analizando espectro…
              </div>
            ) : analyzeError ? (
              <p className="text-xs text-red-400">{analyzeError}</p>
            ) : item.spectrum ? (
              <>
                <img
                  data-testid="spectrogram"
                  src={item.spectrum.image}
                  alt="Espectrograma"
                  className="w-full rounded-lg border border-[var(--color-line)]"
                />
                <p className="mt-2 text-xs text-neutral-500">
                  Energía hasta ~{formatKHz(item.spectrum.cutoffHz)} de{' '}
                  {formatKHz(item.spectrum.sampleRateHz / 2)} (Nyquist). Un corte brusco por debajo
                  delata un MP3 reconvertido a WAV.
                </p>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-[var(--color-line)] p-4">
          <div className="min-w-0 text-xs text-neutral-500">
            <span className="text-neutral-400">Salida:</span>{' '}
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
              ✓ Hecho — mostrar archivo
            </button>
          ) : (
            <button
              data-testid="process-btn"
              onClick={onProcess}
              disabled={item.status === 'processing'}
              className="shrink-0 rounded-lg bg-[var(--color-accent)] px-5 py-2 text-sm font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              {item.status === 'processing' ? 'Procesando…' : 'Convertir a AIFF + Apple Music'}
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
  label: string
  value: string
  onChange: (v: string) => void
  wide?: boolean
}

function Field({ label, value, onChange, wide }: FieldProps): React.JSX.Element {
  return (
    <label className={`block ${wide ? 'col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      <input
        data-testid={`field-${label}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-ink)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />
    </label>
  )
}
