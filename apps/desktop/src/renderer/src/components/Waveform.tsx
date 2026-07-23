import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useWaveform } from '../hooks/useWaveform'
import { parseColor } from '../lib/spectrumColors'
import { drawWaveform } from '../lib/waveform'
import { WaveformSkeleton } from './WaveformSkeleton'

// Fixed internal raster scaled by CSS to the container: the peak array is 2048
// buckets, so ~half a bucket per device pixel at typical panel widths —
// resolution-independent enough without a resize observer.
const CANVAS_W = 1200
// 128 keeps the raster 1:1 with device pixels at the strip's 64px CSS height on @2x
// displays — the height the raster is scaled to, so it must track the h-16 below.
const CANVAS_H = 128

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

  // The bars take the theme accent rather than drawWaveform's fixed blue, which washed
  // out against the light theme's pale panels. The theme is written one-way to
  // <html data-theme> with no React store (same situation as useSpectrumDuotone), so
  // repaint by observing that attribute and re-reading the token.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !wave) return
    const draw = (): void => {
      const [r, g, b] = parseColor(
        getComputedStyle(document.documentElement).getPropertyValue('--color-accent'),
      )
      drawWaveform(canvas, wave.peaks, { color: `rgba(${r}, ${g}, ${b}, 0.8)`, rms: wave.rms })
    }
    draw()
    const observer = new MutationObserver(draw)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
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
        className="block h-16 w-full bg-black/15"
      />
      {loading && <WaveformSkeleton testid="waveform-loading" />}
      {playheadSec !== null && durationSec > 0 && (
        // Positioned via transform on a full-width carrier (translateX % is of the
        // carrier's own width, i.e. the strip) instead of animating `left`, which
        // forces layout + paint on every ~4 Hz timeupdate; a transform stays on the
        // compositor, so playback doesn't repaint the strip while the list scrolls.
        <div
          className="pointer-events-none absolute inset-0"
          style={{ transform: `translateX(${pct(playheadSec)}%)` }}
        >
          <div
            data-testid="waveform-playhead"
            // White, not accent: the wave itself is accent-blue, so a blue playhead
            // vanished into it. bg-fg reads against both the blue bars and the dark
            // ground, and a soft glow lifts it off a busy stretch — the same white
            // audition playhead the wave sections use.
            className="absolute top-0 left-0 h-full w-0.5 -translate-x-1/2 bg-fg shadow-[0_0_3px_rgba(0,0,0,0.6)]"
          />
        </div>
      )}
    </div>
  )
}
