import type React from 'react'
import { prefersReducedMotion } from '../lib/motion'
import { FLAT_WAVE, type RowState, wavePath } from '../lib/usbExport'

// One track's small waveform in the export list (rekordbox's own preview). The motion of
// the whole export lives here: the row being copied reveals its waveform left to right as
// the bytes land, a clip-path transition and nothing else, so a tick re-renders one row.
// Surco's chart colours: what is still to come in the dim ink, what landed in the accent.
export function TrackWave({
  bars,
  state,
  fraction,
}: {
  bars: number[] | null
  state: RowState
  fraction: number
}): React.JSX.Element {
  if (state === 'queued')
    return (
      <svg
        data-testid="track-wave-queued"
        viewBox="0 0 100 16"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-4 w-full"
      >
        <line
          x1="0"
          y1="8"
          x2="100"
          y2="8"
          stroke="var(--color-line-strong)"
          strokeWidth="1"
          strokeDasharray="2 2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    )
  const d = wavePath(bars ?? FLAT_WAVE)
  const shown =
    state === 'copying' ? Math.min(Math.max(fraction, 0), 1) : state === 'failed' ? 0 : 1
  return (
    <svg
      data-testid="track-wave"
      data-flat={bars ? undefined : 'true'}
      viewBox="0 0 100 16"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="h-4 w-full"
    >
      <path d={d} fill="var(--color-fg-faint)" opacity={0.45} />
      <path
        data-testid="track-wave-fill"
        d={d}
        fill="var(--color-accent)"
        opacity={state === 'kept' ? 0.55 : 1}
        style={{
          clipPath: `inset(0 ${Math.round((1 - shown) * 100)}% 0 0)`,
          transition: prefersReducedMotion() ? 'none' : 'clip-path 250ms linear',
        }}
      />
    </svg>
  )
}
