import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useWaveform } from '../hooks/useWaveform'

// Fixed internal raster scaled by CSS to the container: the peak array is 2048
// buckets, so ~half a bucket per device pixel at typical panel widths —
// resolution-independent enough without a resize observer.
const CANVAS_W = 1200
const CANVAS_H = 96

function drawWaveform(canvas: HTMLCanvasElement, peaks: number[]): void {
  const ctx = canvas.getContext('2d')
  // jsdom (tests) has no 2D context; the scrub/playhead geometry is asserted via the DOM.
  if (!ctx) return
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
  const mid = CANVAS_H / 2
  ctx.fillStyle = 'rgba(96, 165, 250, 0.8)'
  const barW = CANVAS_W / peaks.length
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(peaks[i] * (CANVAS_H / 2 - 2), 0.5)
    ctx.fillRect(i * barW, mid - h, Math.max(barW - 0.5, 0.5), h * 2)
  }
}

// The player's scrubbable waveform. Clicking or dragging seeks (onScrub gets the
// position in seconds); the playhead follows playback while `active`.
export function Waveform({
  inputPath,
  audioRef,
  active,
  onScrub,
}: {
  inputPath: string
  audioRef: React.RefObject<HTMLAudioElement | null>
  active: boolean
  onScrub: (seconds: number) => void
}): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playheadSec, setPlayheadSec] = useState<number | null>(null)

  const { data: wave, isFetching } = useWaveform(inputPath, true)
  const durationSec = wave?.durationSec ?? 0

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas && wave) drawWaveform(canvas, wave.peaks)
  }, [wave])

  // Track the player's position only while it streams this track; any other
  // source (or a closed player) hides the playhead instead of lying.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !active) {
      setPlayheadSec(null)
      return
    }
    const onTime = (): void => setPlayheadSec(audio.currentTime)
    onTime()
    audio.addEventListener('timeupdate', onTime)
    return () => audio.removeEventListener('timeupdate', onTime)
  }, [audioRef, active])

  if (isFetching) {
    return (
      <div
        data-testid="waveform-loading"
        className="h-12 w-full animate-pulse bg-[var(--color-line-strong)]/25"
      />
    )
  }
  if (!wave || durationSec === 0) return null

  const pct = (sec: number): number => (sec / durationSec) * 100

  function scrubFrom(clientX: number, el: HTMLElement): void {
    const rect = el.getBoundingClientRect()
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onScrub(ratio * durationSec)
  }

  return (
    <div
      data-testid="waveform"
      className="relative cursor-pointer"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        scrubFrom(e.clientX, e.currentTarget)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) scrubFrom(e.clientX, e.currentTarget)
      }}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        className="block h-12 w-full bg-black/15"
      />
      {playheadSec !== null && (
        <div
          data-testid="waveform-playhead"
          className="pointer-events-none absolute top-0 h-full w-px bg-accent"
          style={{ left: `${pct(playheadSec)}%` }}
        />
      )}
    </div>
  )
}
