// The click-repair intensity ladder and its one translation into an ffmpeg filter.
// Lives in shared next to normalizeDeclick, which both processes read: main repairs
// stored settings with it and the renderer resolves the settings context through it.
import type { DeclickConfig, DeclickMode } from './types'

export const DEFAULT_DECLICK: DeclickConfig = { mode: 'off', rumble: false }

const MODES = ['off', 'soft', 'standard', 'strong'] as const

function isMode(value: unknown): value is DeclickMode {
  return typeof value === 'string' && MODES.includes(value as DeclickMode)
}

// Reads a stored value as a config, or undefined when it is not one: every file before
// the rumble cut holds a bare mode string (which keeps its mode, rumble off), and a
// short-lived dev shape stored {mode, sensitivity} — its mode survives.
export function parseDeclick(value: unknown): DeclickConfig | undefined {
  if (isMode(value)) return { mode: value, rumble: false }
  if (typeof value === 'object' && value !== null) {
    const { mode, rumble } = value as { mode?: unknown; rumble?: unknown }
    if (isMode(mode)) return { mode, rumble: rumble === true }
  }
  return undefined
}

// The Settings read: anything unreadable falls back to off.
export function normalizeDeclick(value: unknown): DeclickConfig {
  return parseDeclick(value) ?? DEFAULT_DECLICK
}

export function sameDeclick(a: DeclickConfig, b: DeclickConfig): boolean {
  return a.mode === b.mode && a.rumble === b.rumble
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
function clickFilter(mode: DeclickMode): string | null {
  if (mode === 'soft') return 'adeclick=t=4'
  if (mode === 'standard') return 'adeclick'
  if (mode === 'strong') return 'adeclick=b=4'
  return null
}

// The rumble cut: two second-order Butterworth highpasses at 20 Hz, a fourth-order slope
// measured on sines at −25 dB at 10 Hz and −49 dB at 5 Hz (turntable rumble) against
// −0.5 dB at 40 Hz and −0.2 dB at 50 Hz (sub and kick). A 25 Hz corner took 1.2 dB off
// 40 Hz, real music in a club track. Ahead of the click repair, so adeclick models the
// signal without the subsonic swing under it.
const RUMBLE_FILTER = 'highpass=f=20,highpass=f=20'

export function declickFilter({ mode, rumble }: DeclickConfig): string | null {
  return [rumble ? RUMBLE_FILTER : null, clickFilter(mode)].filter(Boolean).join(',') || null
}
