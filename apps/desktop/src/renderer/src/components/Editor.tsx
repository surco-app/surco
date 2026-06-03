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
import { isStale } from '../lib/dirty'
import { openFeedback } from '../lib/feedback'
import { FIELD_DEFS } from '../lib/fields'
import { genrePresets } from '../lib/genre'
import { renderOutputName } from '../lib/outputName'
import { formatKHz, qualityVerdict } from '../lib/quality'
import { bestTrack, buildReleaseMeta, resultFromRelease } from '../lib/release'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'
import { ResizeHandle, useResizableWidth } from './ResizeHandle'
import { Spectrogram } from './Spectrogram'
import { WaveSpinner } from './WaveSpinner'

const FORMATS: OutputFormat[] = ['aiff', 'mp3', 'wav', 'flac']

interface Props {
  item: TrackItem
  hasToken: boolean
  outputFormat: OutputFormat
  addToAppleMusic: boolean
  filenameFormat: string
  groupingPresets: string[]
  visibleFields: string[]
  requiredFields: string[]
  showSpectrum: boolean
  searchInputRef: React.RefObject<HTMLInputElement | null>
  onChange: (patch: Partial<TrackItem>) => void
  onProcess: (format: OutputFormat) => void
  onAddToAppleMusic: () => void
  onOpenSettings: () => void
}

export function Editor({
  item,
  hasToken,
  outputFormat,
  addToAppleMusic,
  filenameFormat,
  groupingPresets,
  visibleFields,
  requiredFields,
  showSpectrum,
  searchInputRef,
  onChange,
  onProcess,
  onAddToAppleMusic,
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
  const [outputOpen, setOutputOpen] = useState(true)
  const [inLibrary, setInLibrary] = useState<'idle' | 'yes' | 'no'>('idle')
  const releaseRef = useRef<DiscogsRelease | null>(null)
  const coverDragPath = useRef<string | null>(null)
  const discogs = useResizableWidth(400, 320, 720)

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

  function commitMeta(
    rel: DiscogsRelease,
    track: DiscogsTrack | undefined,
    coverFallback?: string,
  ): void {
    onChange(buildReleaseMeta(item.meta, rel, track, coverFallback))
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
              disabled={busy}
              className="press rounded-lg bg-[var(--color-accent)] px-3.5 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
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
                  className="group relative shrink-0 self-start"
                  title={tr('editor.coverTitle')}
                >
                  {item.coverUrl ? (
                    <>
                      <img
                        data-testid="cover-preview"
                        src={item.coverUrl}
                        alt={tr('editor.coverAlt')}
                        draggable
                        onDragStart={(e) => {
                          if (!coverDragPath.current) return
                          e.preventDefault()
                          window.api.startCoverDrag(coverDragPath.current)
                        }}
                        className={`h-44 w-44 rounded-xl object-cover outline outline-1 -outline-offset-1 outline-white/10 ${
                          coverDragging ? 'ring-2 ring-[var(--color-accent)]' : ''
                        }`}
                      />
                      <button
                        type="button"
                        data-testid="cover-export"
                        onClick={onCoverExport}
                        title={tr('editor.coverExport')}
                        aria-label={tr('editor.coverExport')}
                        className="press absolute right-2 bottom-2 rounded-lg bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/75"
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
                      </button>
                    </>
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

          {showSpectrum && (
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
          )}

          <div className="mt-6 border-t border-[var(--color-line)] pt-5">
            <SectionHeader
              title={tr('editor.outputName')}
              open={outputOpen}
              onToggle={() => setOutputOpen((v) => !v)}
              right={
                <button
                  type="button"
                  data-testid="regenerate-output-name"
                  onClick={() => onChange({ outputName: undefined })}
                  title={tr('editor.regenerateHint')}
                  className="press flex items-center gap-1.5 rounded-md text-xs text-fg-dim hover:text-fg"
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
                  .{outputFormat}
                </span>
              </label>
            )}
            {outputOpen && (
              <p className="mt-2 text-xs text-fg-dim">{tr('editor.outputNameHint')}</p>
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
            <ExportButton
              status={item.status}
              stale={stale}
              done={done}
              outputFormat={outputFormat}
              exportedFormat={exportedFormat}
              withAppleMusic={
                window.api.platform === 'darwin' && outputFormat !== 'flac' && addToAppleMusic
              }
              onProcess={onProcess}
            />
            {done && (
              <div className="flex gap-2">
                <button
                  onClick={() => item.outputPath && window.api.reveal(item.outputPath)}
                  className="press flex-1 rounded-lg border border-good/40 bg-good/10 py-2.5 text-sm font-medium text-good hover:bg-good/15"
                >
                  {tr('editor.doneReveal')}
                </button>
                {window.api.platform === 'darwin' && exportedFormat !== 'flac' && (
                  <button
                    type="button"
                    data-testid="add-apple-music"
                    onClick={onAddToAppleMusic}
                    disabled={item.musicStatus === 'adding' || item.musicStatus === 'added'}
                    className="press flex-1 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-panel-2)] py-2.5 text-sm font-medium hover:bg-[var(--color-line-strong)] disabled:opacity-60 disabled:hover:bg-[var(--color-panel-2)]"
                  >
                    {item.musicStatus === 'adding'
                      ? tr('editor.appleMusicAdding')
                      : item.musicStatus === 'added'
                        ? tr('editor.appleMusicAdded')
                        : tr('editor.appleMusicAdd')}
                  </button>
                )}
              </div>
            )}
            {done && item.musicStatus === 'error' && (
              <p className="text-xs text-danger">{item.musicError}</p>
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
  onProcess: (format: OutputFormat) => void
}

// A split button: the body exports in the user's default format (from Settings),
// the chevron opens a menu to export in any other format on the spot. The control
// stays visible after a track is done so re-exporting to another format never
// means reloading the file or touching Settings.
function ExportButton({
  status,
  stale,
  done,
  outputFormat,
  exportedFormat,
  withAppleMusic,
  onProcess,
}: ExportButtonProps): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const processing = status === 'processing'

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
    : stale
      ? tr('editor.update')
      : done
        ? tr('editor.exportAgain')
        : tr(withAppleMusic ? 'editor.convert' : 'editor.convertNoMusic', {
            format: outputFormat.toUpperCase(),
          })

  function pick(format: OutputFormat): void {
    setOpen(false)
    onProcess(format)
  }

  return (
    <div ref={ref} className="relative flex">
      <button
        type="button"
        data-testid="process-btn"
        onClick={() => onProcess(outputFormat)}
        disabled={processing}
        className="press flex-1 rounded-l-lg bg-[var(--color-accent)] py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {label}
      </button>
      <button
        type="button"
        data-testid="process-format-toggle"
        aria-label={tr('editor.chooseFormat')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        disabled={processing}
        className="press flex w-10 items-center justify-center rounded-r-lg border-l border-white/20 bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
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
              onClick={() => pick(id)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)]"
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
