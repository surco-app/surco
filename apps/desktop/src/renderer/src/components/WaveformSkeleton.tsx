import type React from 'react'
import { useEffect, useRef } from 'react'
import { useThemeRgb } from '../hooks/useThemeRgb'
import { drawWaveform, skeletonPeaks } from '../lib/waveform'

// The strips' own raster proportions; enough buckets that each bar lands ~1px, so
// the placeholder gets the real wave's thin dense lines instead of a row of blocks.
const RASTER_W = 600
const RASTER_H = 96
const SKELETON_PEAKS = skeletonPeaks(400)

// The decode placeholder, drawn through the same drawWaveform raster as the real
// strips so the stand-in shares the wave-to-come's geometry: thin bars mirrored
// around the centre line. Overlays whatever strip hosts it (absolute inset-0).
// It takes the strips' accent dimmed: close enough that it reads as "a wave is
// coming here", faint enough that it never passes for a decoded one.
export function WaveformSkeleton({ testid }: { testid: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const accent = useThemeRgb('--color-accent')
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawWaveform(canvas, SKELETON_PEAKS, { color: `rgba(${accent}, 0.3)` })
  }, [accent])
  return (
    <canvas
      ref={canvasRef}
      data-testid={testid}
      width={RASTER_W}
      height={RASTER_H}
      // The one placeholder that keeps the pulse rather than .skeleton-sweep: the bars are
      // painted into a canvas, so a background gradient would sit behind an opaque raster and
      // never show. Fading the whole canvas is the only cue CSS can give here, and it works
      // because the shape underneath already reads as a wave-to-come.
      className="pointer-events-none absolute inset-0 h-full w-full animate-pulse"
    />
  )
}
