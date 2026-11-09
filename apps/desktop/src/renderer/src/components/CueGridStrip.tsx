import type React from 'react'
import { useTranslation } from 'react-i18next'
import { nearestBeatMs } from '../../../shared/cueGrid'
import { detectedBeatNear, type GridFit } from '../../../shared/gridEdit'
import { formatTime } from '../lib/duration'

const CHECKS = 6

const signedMs = (ms: number): string => {
  const whole = Math.round(ms)
  return `${whole > 0 ? '+' : whole < 0 ? '−' : ''}${Math.abs(whole)} ms`
}

function PinGlyph(): React.JSX.Element {
  return (
    <svg width="9" height="12" viewBox="0 0 14 18" aria-hidden="true">
      <path d="M4 1h6v6l2 3H2l2-3z" fill="var(--color-accent)" />
      <path d="M7 10v7" stroke="var(--color-accent)" strokeWidth="1.8" />
    </svg>
  )
}

export function CueGridStrip({
  beats,
  kicks,
  fit,
  durationMs,
  tolerance,
  playheadMs,
  pins,
  onSeek,
}: {
  beats: number[]
  kicks: number[]
  fit: GridFit
  durationMs: number
  tolerance: number
  playheadMs: number
  pins: number[]
  onSeek: (ms: number) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const pct = (ms: number): string => `${(ms / durationMs) * 100}%`
  const checks = Array.from({ length: CHECKS }, (_, i) => {
    const kickMs = detectedBeatNear(fit, (durationMs * (i + 0.5)) / CHECKS, kicks)
    return { kickMs, offsetMs: nearestBeatMs(kickMs, beats) - kickMs }
  })
  const onCheck = (ms: number) => checks.some((c) => Math.abs(c.kickMs - ms) < 1)
  return (
    <div data-testid="cues-grid-windows" className="relative h-5 shrink-0">
      {checks.map(({ kickMs, offsetMs }) => {
        const ok = Math.abs(offsetMs) <= tolerance
        const pinned = pins.some((p) => Math.abs(p - kickMs) < 1)
        const current = Math.abs(playheadMs - kickMs) < 1
        return (
          <button
            key={kickMs}
            type="button"
            data-testid={`cues-grid-window-${Math.round(kickMs)}`}
            data-pinned={pinned ? 'true' : undefined}
            onClick={() => onSeek(kickMs)}
            aria-label={t('editor.cues.grid.window', {
              time: formatTime(kickMs / 1000),
              ms: signedMs(offsetMs),
            })}
            style={{ left: pct(kickMs), color: ok ? 'var(--color-good)' : 'var(--color-warn)' }}
            className={`press absolute inset-y-0 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 text-[11px] font-semibold tabular-nums hover:bg-[var(--color-hover)] ${
              current ? 'bg-[var(--color-panel-2)]' : ''
            }`}
          >
            {pinned ? (
              <PinGlyph />
            ) : (
              <span
                aria-hidden="true"
                style={{ backgroundColor: ok ? 'var(--color-good)' : 'var(--color-warn)' }}
                className="h-1.5 w-1.5 rounded-full"
              />
            )}
            {signedMs(offsetMs)}
          </button>
        )
      })}
      {pins
        .filter((p) => !onCheck(p))
        .map((p) => (
          <span
            key={p}
            data-testid={`cues-grid-pin-${Math.round(p)}`}
            aria-hidden="true"
            style={{ left: pct(p) }}
            className="absolute inset-y-0 flex -translate-x-1/2 items-center"
          >
            <PinGlyph />
          </span>
        ))}
    </div>
  )
}
