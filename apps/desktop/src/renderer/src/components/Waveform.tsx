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
  audioDurationSec = 0,
  onScrub,
}: {
  inputPath: string
  audioRef: React.RefObject<HTMLAudioElement | null>
  active: boolean
  audioDurationSec?: number
  onScrub: (seconds: number) => void
}): React.JSX.Element | null {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playheadSec, setPlayheadSec] = useState<number | null>(null)

  const { data: wave, isFetching } = useWaveform(inputPath, true)
  // The strip's geometry follows the playback clock so a DJ can scrub the instant
  // the element reports a duration — seconds before the full-file decode delivers
  // the peaks. We only fall back to the decoded duration when there's no element
  // duration yet (e.g. before metadata loads, or in tests with no <audio>).
  const durationSec = audioDurationSec || wave?.durationSec || 0
  const loading = isFetching && !wave

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

  // A null envelope (ffmpeg decoded nothing) with no playback duration to lean on
  // means there's nothing to scrub: render nothing rather than a strip that implies
  // a zero-length track. While decoding we still render — the skeleton needs a home.
  if (!loading && durationSec === 0) return null

  const pct = (sec: number): number => (durationSec === 0 ? 0 : (sec / durationSec) * 100)

  function scrubFrom(clientX: number, el: HTMLElement): void {
    if (durationSec === 0) return
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
      {loading && (
        // Evenly spaced bars pulsing over the strip read clearly as "the waveform is
        // decoding" — the faint full-bleed wash it replaced was easy to mistake for a
        // broken, empty player. Centred on the strip so it mirrors the peaks to come.
        <div
          data-testid="waveform-loading"
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-1/2 h-6 -translate-y-1/2 animate-pulse opacity-60 [background:repeating-linear-gradient(90deg,var(--color-line-strong)_0,var(--color-line-strong)_3px,transparent_3px,transparent_8px)]"
        />
      )}
      {playheadSec !== null && durationSec > 0 && (
        <div
          data-testid="waveform-playhead"
          className="pointer-events-none absolute top-0 h-full w-px bg-accent"
          style={{ left: `${pct(playheadSec)}%` }}
        />
      )}
    </div>
  )
}
