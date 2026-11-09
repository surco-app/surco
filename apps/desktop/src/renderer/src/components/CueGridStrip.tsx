import type React from 'react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { nearestBeatMs } from '../../../shared/cueGrid'
import { detectedBeatNear, type GridFit } from '../../../shared/gridEdit'
import { useThemeRgb } from '../hooks/useThemeRgb'
import { type DetailSource, paintWave, waveColumns } from '../lib/cueDetail'
import { formatTime } from '../lib/duration'

const WINDOWS = 6
const WIDTH = 118
const HEIGHT = 44

const signedMs = (ms: number): string => {
  const whole = Math.round(ms)
  return `${whole > 0 ? '+' : whole < 0 ? '−' : ''}${Math.abs(whole)} ms`
}

function Window({
  source,
  kickMs,
  period,
  offsetMs,
  tolerance,
  current,
  pinned,
  onSeek,
}: {
  source: DetailSource | null
  kickMs: number
  period: number
  offsetMs: number
  tolerance: number
  current: boolean
  pinned: boolean
  onSeek: (ms: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const accent = useThemeRgb('--color-accent')
  const faint = useThemeRgb('--color-fg-faint')
  useEffect(() => {
    const canvas = canvasRef.current
    const g = canvas?.getContext('2d')
    if (!canvas || !g || !source) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = WIDTH * dpr
    canvas.height = HEIGHT * dpr
    g.clearRect(0, 0, canvas.width, canvas.height)
    paintWave(
      g,
      waveColumns(source, kickMs - period / 2, kickMs + period / 2, canvas.width),
      canvas.height,
      { peak: `rgb(${faint})`, body: `rgb(${accent})` },
      0.8,
    )
  }, [source, kickMs, period, accent, faint])
  const ok = Math.abs(offsetMs) <= tolerance
  const left = Math.max(1, Math.min(WIDTH - 2, WIDTH / 2 + (offsetMs / period) * WIDTH))
  return (
    <button
      type="button"
      data-testid={`cues-grid-window-${Math.round(kickMs)}`}
      onClick={() => onSeek(kickMs)}
      aria-label={t('editor.cues.grid.window', {
        time: formatTime(kickMs / 1000),
        ms: signedMs(offsetMs),
      })}
      style={{ width: WIDTH, height: HEIGHT }}
      className={`press relative shrink-0 overflow-hidden rounded-md border bg-[var(--color-field)] text-left hover:border-[var(--color-input-border)] ${
        current
          ? 'border-[var(--color-fg)]'
          : pinned
            ? 'border-[var(--color-accent)]'
            : 'border-[var(--color-line)]'
      }`}
    >
      <canvas ref={canvasRef} style={{ width: WIDTH, height: HEIGHT }} className="block" />
      <span
        aria-hidden="true"
        style={{ left, backgroundColor: ok ? 'var(--color-good)' : 'var(--color-warn)' }}
        className="absolute top-3.5 bottom-0 w-px opacity-90"
      />
      <span className="absolute top-0.5 left-1.5 text-[10px] tabular-nums text-fg-faint">
        {formatTime(kickMs / 1000)}
      </span>
      <span
        className="absolute top-0.5 right-1.5 flex items-center gap-1 text-[10px] font-semibold tabular-nums"
        style={{ color: ok ? 'var(--color-good)' : 'var(--color-warn)' }}
      >
        <span
          aria-hidden="true"
          style={{ backgroundColor: ok ? 'var(--color-good)' : 'var(--color-warn)' }}
          className="h-1.5 w-1.5 rounded-full"
        />
        {signedMs(offsetMs)}
      </span>
      {pinned && (
        <svg
          width="12"
          height="16"
          viewBox="0 0 14 18"
          aria-hidden="true"
          className="absolute bottom-0.5 left-1/2 -translate-x-1/2"
        >
          <path d="M4 1h6v6l2 3H2l2-3z" fill="var(--color-accent)" />
          <path d="M7 10v7" stroke="var(--color-accent)" strokeWidth="1.6" />
        </svg>
      )}
    </button>
  )
}

export function CueGridStrip({
  source,
  beats,
  fit,
  durationMs,
  tolerance,
  playheadMs,
  pins,
  onSeek,
  onClearPins,
}: {
  source: DetailSource | null
  beats: number[]
  fit: GridFit
  durationMs: number
  tolerance: number
  playheadMs: number
  pins: number[]
  onSeek: (ms: number) => void
  onClearPins: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const period = 60000 / fit.bpm
  const windows = Array.from({ length: WINDOWS }, (_, i) => {
    const kickMs = detectedBeatNear(fit, (durationMs * (i + 0.5)) / WINDOWS)
    return { kickMs, offsetMs: nearestBeatMs(kickMs, beats) - kickMs }
  })
  const bad = windows.filter((w) => Math.abs(w.offsetMs) > tolerance).length
  return (
    <div data-testid="cues-grid-windows" className="flex shrink-0 items-center gap-2">
      <div className="flex w-[104px] shrink-0 flex-col gap-1 text-[11px] leading-tight">
        <span className="text-fg-faint">{t('editor.cues.grid.track')}</span>
        <span data-testid="cues-grid-track-summary" className="text-fg-dim">
          {bad === 0
            ? t('editor.cues.grid.trackFits')
            : t('editor.cues.grid.trackOff', { count: bad, total: WINDOWS })}
        </span>
        {pins.length > 0 && (
          <button
            type="button"
            data-testid="cues-grid-unpin"
            onClick={onClearPins}
            style={{ color: 'var(--color-accent)' }}
            className="press w-fit text-[11px] hover:underline"
          >
            {t('editor.cues.grid.unpin', { count: pins.length })}
          </button>
        )}
      </div>
      {windows.map((w) => (
        <Window
          key={w.kickMs}
          source={source}
          kickMs={w.kickMs}
          period={period}
          offsetMs={w.offsetMs}
          tolerance={tolerance}
          current={Math.abs(playheadMs - w.kickMs) < 1}
          pinned={pins.some((p) => Math.abs(p - w.kickMs) < 1)}
          onSeek={onSeek}
        />
      ))}
    </div>
  )
}
