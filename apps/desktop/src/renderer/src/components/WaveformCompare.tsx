import { Columns2, Layers2 } from 'lucide-react'
import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LoudnessResult, WaveformResult } from '../../../shared/types'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { useWaveform } from '../hooks/useWaveform'
import { formatDb } from '../lib/quality'
import { drawWaveform, skeletonPeaks } from '../lib/waveform'
import { Tooltip } from './Tooltip'

// Half the player strip's raster per side-by-side column (each sits in half the
// panel width); the overlaid canvas spans the panel, so it gets the full raster.
const CANVAS_W = 600
const OVERLAY_W = 1200
const CANVAS_H = 64

const SKELETON_PEAKS = skeletonPeaks(40)

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

function Strip({ wave, loading, color }: StripData & { color: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && wave) drawWaveform(canvas, wave.peaks, { color })
  }, [wave, color])
  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="block h-12 w-full rounded-lg bg-[var(--color-field)]"
      />
      {loading && <Skeleton />}
    </div>
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

// The source and converted files compared — side by side or overlaid, the legends
// (colour dot, label, measured figures) staying up in either view.
export function WaveformCompare({
  inputPath,
  outputPath,
  enabled,
}: {
  inputPath: string
  outputPath: string
  enabled: boolean
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
          <Strip {...before} color={BEFORE_COLOR} />
          <Strip {...after} color={AFTER_COLOR} />
        </div>
      ) : (
        <OverlayStrip before={before} after={after} />
      )}
    </div>
  )
}
