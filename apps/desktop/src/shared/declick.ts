// The click-repair intensity ladder and its one translation into an ffmpeg filter.
// Lives in shared next to normalizeDeclick, which both processes read: main repairs
// stored settings with it and the renderer resolves the settings context through it.
import type { DeclickMode } from './types'

export const DEFAULT_DECLICK: DeclickMode = 'off'

const MODES = ['off', 'soft', 'standard', 'strong'] as const

// Repairs any stored value into a valid mode: 0.49-0.50 files hold one of the
// original strings, and a short-lived dev shape stored {mode, sensitivity} — its
// mode survives, anything else falls back to off.
export function normalizeDeclick(value: unknown): DeclickMode {
  if (typeof value === 'string' && MODES.includes(value as DeclickMode))
    return value as DeclickMode
  if (typeof value === 'object' && value !== null) {
    const mode = (value as { mode?: unknown }).mode
    if (typeof mode === 'string' && MODES.includes(mode as DeclickMode)) return mode as DeclickMode
  }
  return DEFAULT_DECLICK
}

// The -af stage for each intensity, one calibrated step apart:
// - soft: detection threshold raised to t=4 — synthetic 2- and 9-sample clicks
//   still repair fully, but on clean commercial tracks the touched share falls
//   from 6.3% to 0.45%, so it's the step for delicate material where the
//   audition reveals bites on the music.
// - standard: adeclick's own defaults, which fully repair 1-2 sample stylus clicks.
// - strong: burst fusion raised to the MINIMUM that also repairs long pops
//   (b=3 leaves them, b=4 removes them completely).
// Two directions are deliberately unreachable, both measured hang zones: t below
// 2 and b above 4 explode the AR interpolation cost past realtime on dense music
// ("hung conversion" reports, twice). The window stays default (w=20 repairs worse).
export function declickFilter(mode: DeclickMode): string | null {
  if (mode === 'soft') return 'adeclick=t=4'
  if (mode === 'standard') return 'adeclick'
  if (mode === 'strong') return 'adeclick=b=4'
  return null
}
