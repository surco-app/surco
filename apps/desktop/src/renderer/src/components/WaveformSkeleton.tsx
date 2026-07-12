import type React from 'react'
import { useEffect, useRef } from 'react'
import { drawWaveform, skeletonPeaks } from '../lib/waveform'

// The strips' own raster proportions; enough buckets that each bar lands ~1px, so
// the placeholder gets the real wave's thin dense lines instead of a row of blocks.
const RASTER_W = 600
const RASTER_H = 96
const SKELETON_PEAKS = skeletonPeaks(400)

// The legends' muted grey, dimmed — hardcoded like the strips' blue/grey because
// the canvas raster can't read CSS variables.
const SKELETON_COLOR = 'rgba(148, 163, 184, 0.35)'

// The decode placeholder, drawn through the same drawWaveform raster as the real
// strips so the stand-in shares the wave-to-come's geometry: thin bars mirrored
// around the centre line. Overlays whatever strip hosts it (absolute inset-0).
export function WaveformSkeleton({ testid }: { testid: string }): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawWaveform(canvas, SKELETON_PEAKS, { color: SKELETON_COLOR })
  }, [])
  return (
    <canvas
      ref={canvasRef}
      data-testid={testid}
      width={RASTER_W}
      height={RASTER_H}
      className="pointer-events-none absolute inset-0 h-full w-full animate-pulse"
    />
  )
}
