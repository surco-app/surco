import type React from 'react'
import { useEffect, useRef } from 'react'
import type { WaveformResult } from '../../../shared/types'
import { clickMarks } from '../lib/clickMarks'
import { drawWaveform } from '../lib/waveform'

const RASTER_W = 1200
const RASTER_H = 40

interface Props {
  wave: WaveformResult
  color: string
  // The slice the zoomed strip above shows, as 0..1 fractions of the track.
  view: { from: number; to: number }
  marks: number[]
  atSec: number
  // Asks for the view to start at this fraction; the owner clamps and scrolls.
  onPan: (from: number) => void
}

// The whole track under a zoomed strip, with a box over the stretch the strip shows.
// Zoomed in, the strip alone hides where you are and where the other clicks are; this
// answers both and is the handle a mouse needs to get there — grab the box and drag it,
// or click anywhere else to centre the view there.
export function WaveOverview({ wave, color, view, marks, atSec, onPan }: Props): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const grabRef = useRef<number | null>(null)
  const span = view.to - view.from
  const dur = wave.durationSec

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas) drawWaveform(canvas, wave.peaks, { color, rms: wave.rms })
  }, [wave, color])

  const fracAt = (clientX: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect()
    return rect.width === 0 ? 0 : (clientX - rect.left) / rect.width
  }

  return (
    <div
      data-testid="declick-overview"
      aria-hidden="true"
      className="relative mt-1.5 h-5 cursor-pointer touch-none overflow-hidden rounded"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const frac = fracAt(e.clientX, e.currentTarget)
        const onBox = frac >= view.from && frac <= view.to
        grabRef.current = onBox ? frac - view.from : span / 2
        if (!onBox) onPan(frac - grabRef.current)
      }}
      onPointerMove={(e) => {
        if (grabRef.current === null || !e.currentTarget.hasPointerCapture?.(e.pointerId)) return
        onPan(fracAt(e.clientX, e.currentTarget) - grabRef.current)
      }}
      onPointerUp={() => {
        grabRef.current = null
      }}
      onPointerCancel={() => {
        grabRef.current = null
      }}
    >
      <canvas
        ref={canvasRef}
        width={RASTER_W}
        height={RASTER_H}
        className="block h-full w-full bg-[var(--color-field)]"
      />
      {clickMarks(marks, dur, { from: 0, to: 1 }).map((m) => (
        <span
          key={m.sec}
          className="pointer-events-none absolute inset-y-0 w-px bg-warn"
          style={{ left: `${m.pct}%` }}
        />
      ))}
      {dur > 0 && (
        <span
          className="pointer-events-none absolute inset-y-0 w-px bg-fg"
          style={{ left: `${(atSec / dur) * 100}%` }}
        />
      )}
      <div
        data-testid="declick-overview-window"
        className="absolute inset-y-0 cursor-grab rounded border border-accent bg-accent/15 active:cursor-grabbing"
        style={{ left: `${view.from * 100}%`, width: `${span * 100}%` }}
      />
    </div>
  )
}
