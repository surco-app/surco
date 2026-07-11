import { Columns2, Layers2, ZoomIn, ZoomOut } from 'lucide-react'
import type React from 'react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoudnessResult, NormalizeConfig, WaveformResult } from '../../../shared/types'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { useWaveform } from '../hooks/useWaveform'
import { formatDb } from '../lib/quality'
import { formatTime } from '../lib/duration'
import { clippedCount, drawWaveform, previewPeaks, skeletonPeaks } from '../lib/waveform'
import { Tooltip } from './Tooltip'

// Half the player strip's raster per side-by-side column (each sits in half the
// panel width); the overlaid canvas spans the panel, so it gets the full raster.
const CANVAS_W = 600
const OVERLAY_W = 1200
const CANVAS_H = 64

const SKELETON_PEAKS = skeletonPeaks(40)

// The deepest zoom step: ×8 across a 6-minute track puts ~2 s in the visible panel,
// enough to pin a clip down; past that the 2048 decoded buckets have no more to show.
const ZOOM_MAX = 8

// The colour key the legends' dots repeat: the converted file keeps the player's
// accent blue, the source goes muted so "louder than before" reads as blue fringes
// growing past the grey in the overlaid view.
const AFTER_COLOR = 'rgba(96, 165, 250, 0.8)'
const BEFORE_COLOR = 'rgba(148, 163, 184, 0.7)'

type CompareView = 'side' | 'overlay'

interface StripData {
  wave: WaveformResult | null | undefined
  loading: boolean
  loudness: LoudnessResult | null | undefined
}

// One file's decoded envelope plus its measurement — for the "after" side that's
// the converted output, the figures that say what normalization actually applied.
// Both share the per-path caches the player and the loudness readout warm.
function useStripData(path: string, enabled: boolean): StripData {
  const { data: wave, isFetching } = useWaveform(path, enabled)
  const { data: loudness } = useTrackLoudness(path, enabled)
  return { wave, loading: isFetching && !wave, loudness }
}

function Legend({
  testid,
  color,
  label,
  loudness,
}: {
  testid: string
  color: string
  label: string
  loudness: LoudnessResult | null | undefined
}): React.JSX.Element {
  return (
    <span data-testid={testid} className="flex min-w-0 items-center gap-1.5 text-[10px]">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color }}
      />
      <span className="font-medium uppercase tracking-wider text-fg-dim">{label}</span>
      {loudness && (
        <span className="truncate tabular-nums text-fg-dim">
          {`${formatDb(loudness.integratedLufs)} LUFS · ${formatDb(loudness.truePeakDb)} dBTP`}
        </span>
      )}
    </span>
  )
}

function Skeleton(): React.JSX.Element {
  return (
    <div
      data-testid="waveform-compare-loading"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-center gap-px px-px animate-pulse opacity-50"
    >
      {SKELETON_PEAKS.map((amp, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, never-reordered bar strip
          key={i}
          className="flex-1 rounded-[1px] bg-[var(--color-line-strong)]"
          style={{ height: `${amp * 100}%` }}
        />
      ))}
    </div>
  )
}

function Strip({
  wave,
  loading,
  color,
  clipDb,
  limitDb,
  background,
  raster = CANVAS_W,
  zoom = 1,
}: StripData & {
  color: string
  clipDb?: number
  // The preview's limiter line: bars clamp to it and the clamped ones paint red.
  limitDb?: number
  // A second envelope drawn behind in the muted grey — the original under a preview.
  background?: WaveformResult | null
  raster?: number
  // rekordbox-style stretch factor: the strip grows to zoom× the panel width inside
  // a horizontal scroller. Still the same 2048 decoded buckets, just drawn wider.
  zoom?: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // The cursor's position over the strip, as a 0..1 ratio (for the bucket/time math)
  // plus the raw x (for the readout's placement). Null while the pointer is away.
  const [hover, setHover] = useState<{ x: number; ratio: number } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: zoom/raster only feed the canvas width attribute in JSX, but changing that attribute wipes the bitmap — the effect must re-run to redraw at the new raster or the strip goes blank.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !wave) return
    if (background) drawWaveform(canvas, background.peaks, { color: BEFORE_COLOR })
    drawWaveform(canvas, wave.peaks, { color, clipDb, limitDb, clear: !background })
  }, [wave, color, clipDb, limitDb, background, raster, zoom])
  // A zoom step re-anchors the scroller so the spot in the middle stays in the
  // middle — zooming in on a clip must not teleport the view away from it.
  const prevZoom = useRef(zoom)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || prevZoom.current === zoom) return
    const factor = zoom / prevZoom.current
    prevZoom.current = zoom
    const center = el.scrollLeft + el.clientWidth / 2
    el.scrollLeft = Math.max(0, center * factor - el.clientWidth / 2)
  }, [zoom])
  const readout = ((): { time: string; db: string; over: boolean } | null => {
    if (!hover || !wave || wave.peaks.length === 0) return null
    const idx = Math.min(wave.peaks.length - 1, Math.floor(hover.ratio * wave.peaks.length))
    const amp = wave.peaks[idx]
    const markDb = limitDb ?? clipDb
    // The displayed level honors the preview's limiter, like the drawn bar does.
    const shown = limitDb !== undefined ? Math.min(amp, 10 ** (limitDb / 20)) : amp
    return {
      time: formatTime(hover.ratio * wave.durationSec),
      db: formatDb(shown > 0 ? 20 * Math.log10(shown) : Number.NEGATIVE_INFINITY),
      over: markDb !== undefined && amp > 10 ** (markDb / 20),
    }
  })()
  return (
    <div ref={scrollRef} className={`rounded-lg ${zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
      <div
        data-testid="waveform-strip"
        className="relative"
        style={{ width: `${zoom * 100}%` }}
        onPointerMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          if (rect.width === 0 || !wave) return
          const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left))
          setHover({ x, ratio: x / rect.width })
        }}
        onPointerLeave={() => setHover(null)}
      >
        <canvas
          ref={canvasRef}
          width={raster * zoom}
          height={CANVAS_H}
          className="block h-12 w-full rounded-lg bg-[var(--color-field)]"
        />
        {loading && <Skeleton />}
        {readout && hover && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-fg/40"
              style={{ left: hover.x }}
            />
            {/* Inside the strip, not above it: the scroller clips vertical overflow
                when zoomed, and floating over the legends read as part of them. */}
            <span
              data-testid="waveform-hover"
              className={`pointer-events-none absolute top-1 rounded border border-[var(--color-line)] bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[10px] tabular-nums shadow-sm ${
                readout.over ? 'text-danger' : 'text-fg-muted'
              }`}
              style={{
                left: hover.x,
                transform: `translateX(${hover.ratio > 0.85 ? 'calc(-100% - 6px)' : '6px'})`,
              }}
            >
              {readout.time} · {readout.db} dB
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// The red counterpart to the legends' colour dots, shown only when the wave actually
// pokes over the ceiling: it names the dB line the red bars mark, so the color isn't
// a mystery — and a clean track never warns. It doubles as the switch for the marks:
// a busy vinyl rip can paint mostly red, so a click hides them, another brings them
// back — the label stays up either way so the way back is obvious.
function ClippedFlag({
  wave,
  clipDb,
  active,
  onToggle,
}: {
  wave: WaveformResult | null | undefined
  clipDb: number
  active: boolean
  onToggle: () => void
}): React.JSX.Element | null {
  const { t: tr } = useTranslation()
  if (!wave || clippedCount(wave.peaks, clipDb) === 0) return null
  return (
    <button
      type="button"
      data-testid="waveform-clipped"
      aria-pressed={active}
      onClick={onToggle}
      className="press flex min-w-0 items-center gap-1.5 text-[10px]"
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-line-strong)]'}`}
      />
      <span
        className={`truncate font-medium tabular-nums ${active ? 'text-danger' : 'text-fg-dim'}`}
      >
        {tr('editor.waveformClipped', { db: formatDb(clipDb) })}
      </span>
    </button>
  )
}

// GitHub-style image diff: both envelopes on one canvas, the source behind in grey
// and the converted file over it in blue. On barely-changed audio the two cover
// each other, so an onion-skin fade slider crossfades the blue layer — scrubbing it
// makes the difference move, which the eye catches where a static blend can't.
function OverlayStrip({ before, after }: { before: StripData; after: StripData }): React.JSX.Element {
  const { t: tr } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [fade, setFade] = useState(0.5)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !before.wave || !after.wave) return
    drawWaveform(canvas, before.wave.peaks, { color: BEFORE_COLOR })
    drawWaveform(canvas, after.wave.peaks, {
      color: `rgba(96, 165, 250, ${(0.9 * fade).toFixed(3)})`,
      clear: false,
    })
  }, [before.wave, after.wave, fade])
  return (
    <div data-testid="waveform-overlay">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={OVERLAY_W}
          height={CANVAS_H}
          className="block h-12 w-full rounded-lg bg-[var(--color-field)]"
        />
        {(before.loading || after.loading) && <Skeleton />}
      </div>
      <div className="mt-1.5 flex items-center justify-center gap-2">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: BEFORE_COLOR }}
        />
        <input
          type="range"
          data-testid="waveform-overlay-fade"
          aria-label={tr('editor.waveformFade')}
          min={0}
          max={1}
          step={0.01}
          value={fade}
          onChange={(e) => setFade(Number(e.target.value))}
          className="player-volume-range h-1 w-32 cursor-pointer"
        />
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: AFTER_COLOR }}
        />
      </div>
    </div>
  )
}

// The source's wave alone, for before a conversion exists: the same strip, figures
// and clip marks as the comparison, so the normalization controls above are tuned
// against what the file actually looks like instead of blind. With Loudness or Peak
// dialed in it goes one further: the original drops behind in grey and the predicted
// post-normalization envelope draws in front — a preview of the dials' outcome.
export function WaveformSolo({
  inputPath,
  enabled,
  clipDb,
  normalize,
}: {
  inputPath: string
  enabled: boolean
  clipDb: number
  normalize: NormalizeConfig
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const source = useStripData(inputPath, enabled)
  // The clip marks' switch (the ClippedFlag legend). Per-mount state: a track flip
  // remounts the editor, and marks defaulting back on is the safe reading.
  const [marks, setMarks] = useState(true)
  // rekordbox-style zoom over the strip, ×1..×8 in doublings. Per-mount too: a new
  // track starts at the full-width overview.
  const [zoom, setZoom] = useState(1)
  const preview = useMemo(
    () =>
      source.wave
        ? previewPeaks(source.wave.peaks, normalize, source.loudness?.integratedLufs)
        : null,
    [source.wave, normalize, source.loudness],
  )
  const previewWave =
    preview && source.wave ? { peaks: preview.peaks, durationSec: source.wave.durationSec } : null
  return (
    <div data-testid="waveform-solo" className="mt-3">
      <div className="mb-1.5 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <Legend
          testid="waveform-source"
          color={previewWave ? BEFORE_COLOR : AFTER_COLOR}
          label={tr('editor.waveformSource')}
          loudness={source.loudness}
        />
        {previewWave ? (
          <span data-testid="waveform-preview" className="flex min-w-0 items-center gap-1.5 text-[10px]">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: AFTER_COLOR }}
            />
            <span className="font-medium uppercase tracking-wider text-fg-dim">
              {tr('editor.waveformPreview')}
            </span>
            <span className="truncate tabular-nums text-fg-dim">
              {normalize.mode === 'loudness'
                ? `${formatDb(normalize.targetLufs)} LUFS · ${formatDb(normalize.truePeakDb)} dBTP`
                : `${formatDb(normalize.peakDb)} dBFS`}
            </span>
          </span>
        ) : (
          <ClippedFlag
            wave={source.wave}
            clipDb={clipDb}
            active={marks}
            onToggle={() => setMarks((m) => !m)}
          />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="waveform-zoom-out"
            aria-label={tr('editor.waveformZoomOut')}
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => Math.max(1, z / 2))}
            className="press flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
          >
            <ZoomOut className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="waveform-zoom-reset"
            aria-label={tr('editor.waveformZoomReset')}
            disabled={zoom <= 1}
            onClick={() => setZoom(1)}
            className="press min-w-6 rounded px-1 text-center text-[10px] tabular-nums text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
          >
            {`×${zoom}`}
          </button>
          <button
            type="button"
            data-testid="waveform-zoom-in"
            aria-label={tr('editor.waveformZoomIn')}
            disabled={zoom >= ZOOM_MAX}
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z * 2))}
            className="press flex h-5 w-5 items-center justify-center rounded text-fg-dim hover:text-fg disabled:opacity-30 disabled:hover:text-fg-dim"
          >
            <ZoomIn className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      </div>
      {previewWave && preview ? (
        <Strip
          wave={previewWave}
          loading={source.loading}
          loudness={source.loudness}
          color={AFTER_COLOR}
          limitDb={preview.limitDb}
          background={source.wave}
          raster={OVERLAY_W}
          zoom={zoom}
        />
      ) : (
        <Strip
          {...source}
          color={AFTER_COLOR}
          clipDb={marks ? clipDb : undefined}
          raster={OVERLAY_W}
          zoom={zoom}
        />
      )}
    </div>
  )
}

// The source and converted files compared — side by side or overlaid, the legends
// (colour dot, label, measured figures) staying up in either view.
export function WaveformCompare({
  inputPath,
  outputPath,
  enabled,
  clipDb,
}: {
  inputPath: string
  outputPath: string
  enabled: boolean
  clipDb?: number
}): React.JSX.Element {
  const { t: tr } = useTranslation()
  const [view, setView] = useState<CompareView>('side')
  const before = useStripData(inputPath, enabled)
  const after = useStripData(outputPath, enabled)
  const viewButton = (id: CompareView, label: string, Icon: typeof Columns2): React.JSX.Element => (
    <button
      type="button"
      data-testid={`waveform-view-${id}`}
      aria-label={label}
      aria-pressed={view === id}
      onClick={() => setView(id)}
      className={`press group relative flex h-5 w-6 items-center justify-center rounded ${
        view === id ? 'bg-[var(--color-panel-2)] text-fg' : 'text-fg-dim hover:text-fg'
      }`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <Tooltip label={label} align="end" />
    </button>
  )
  return (
    <div data-testid="waveform-compare" className="mt-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <Legend
            testid="waveform-before"
            color={BEFORE_COLOR}
            label={tr('editor.waveformBefore')}
            loudness={before.loudness}
          />
          <Legend
            testid="waveform-after"
            color={AFTER_COLOR}
            label={tr('editor.waveformAfter')}
            loudness={after.loudness}
          />
        </div>
        <div className="flex shrink-0 gap-0.5 rounded-md bg-[var(--color-field)] p-0.5">
          {viewButton('side', tr('editor.waveformViewSide'), Columns2)}
          {viewButton('overlay', tr('editor.waveformViewOverlay'), Layers2)}
        </div>
      </div>
      {view === 'side' ? (
        <div data-testid="waveform-side" className="grid grid-cols-2 gap-2">
          <Strip {...before} color={BEFORE_COLOR} clipDb={clipDb} />
          <Strip {...after} color={AFTER_COLOR} clipDb={clipDb} />
        </div>
      ) : (
        <OverlayStrip before={before} after={after} />
      )}
    </div>
  )
}
