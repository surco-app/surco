import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useTrackLoudness } from '../hooks/useTrackLoudness'
import { useWaveform } from '../hooks/useWaveform'
import { formatDb } from '../lib/quality'
import { drawWaveform, skeletonPeaks } from '../lib/waveform'

// Half the player strip's raster: each strip sits in half the panel width, so the
// same buckets-per-pixel density holds without a resize observer.
const CANVAS_W = 600
const CANVAS_H = 64

const SKELETON_PEAKS = skeletonPeaks(40)

function Strip({
  label,
  path,
  enabled,
  testid,
}: {
  label: string
  path: string
  enabled: boolean
  testid: string
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { data: wave, isFetching } = useWaveform(path, enabled)
  const loading = isFetching && !wave
  // The strip's own file's measurement — for the "after" strip that's the converted
  // output, the figure that says what normalization actually applied. Shares the
  // per-path loudness cache with the readout above, so the "before" is free.
  const { data: loudness } = useTrackLoudness(path, enabled)

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && wave) drawWaveform(canvas, wave.peaks)
  }, [wave])

  return (
    <div data-testid={testid}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-fg-dim">
          {label}
        </span>
        {loudness && (
          <span className="truncate text-[10px] tabular-nums text-fg-dim">
            {`${formatDb(loudness.integratedLufs)} LUFS · ${formatDb(loudness.truePeakDb)} dBTP`}
          </span>
        )}
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          className="block h-12 w-full rounded-lg bg-[var(--color-field)]"
        />
        {loading && (
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
        )}
      </div>
    </div>
  )
}

// The source and converted peak envelopes side by side — the visual proof of what
// normalization actually did to the file, next to the loudness figures it justifies.
// Both strips read the same per-path waveform cache the player warms, so a track
// already played draws its "before" instantly.
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
  return (
    <div data-testid="waveform-compare" className="mt-3 grid grid-cols-2 gap-2">
      <Strip
        label={tr('editor.waveformBefore')}
        path={inputPath}
        enabled={enabled}
        testid="waveform-before"
      />
      <Strip
        label={tr('editor.waveformAfter')}
        path={outputPath}
        enabled={enabled}
        testid="waveform-after"
      />
    </div>
  )
}
