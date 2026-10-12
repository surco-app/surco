// The click-repair intensity ladder and its one translation into an ffmpeg filter.
// Lives in shared next to normalizeDeclick, which both processes read: main repairs
// stored settings with it and the renderer resolves the settings context through it.
import type { DeclickConfig, DeclickMode, NoiseMode } from './types'

export const DEFAULT_DECLICK: DeclickConfig = { mode: 'off', noise: 'off' }

const MODES = ['off', 'soft', 'standard', 'strong'] as const

function isMode(value: unknown): value is DeclickMode {
  return typeof value === 'string' && MODES.includes(value as DeclickMode)
}

const NOISE_MODES = ['off', 'soft', 'medium', 'strong'] as const

function isNoiseMode(value: unknown): value is NoiseMode {
  return typeof value === 'string' && NOISE_MODES.includes(value as NoiseMode)
}

// Reads a stored value as a config, or undefined when it is not one: every file before
// the noise ladder holds a bare mode string (which keeps its mode, no noise reduction),
// and a short-lived dev shape stored {mode, sensitivity} — its mode survives.
export function parseDeclick(value: unknown): DeclickConfig | undefined {
  if (isMode(value)) return { mode: value, noise: 'off' }
  if (typeof value === 'object' && value !== null) {
    const { mode, noise } = value as { mode?: unknown; noise?: unknown }
    if (isMode(mode)) return { mode, noise: isNoiseMode(noise) ? noise : 'off' }
  }
  return undefined
}

// The Settings read: anything unreadable falls back to off.
export function normalizeDeclick(value: unknown): DeclickConfig {
  return parseDeclick(value) ?? DEFAULT_DECLICK
}

export function sameDeclick(a: DeclickConfig, b: DeclickConfig): boolean {
  return a.mode === b.mode && a.noise === b.noise
}

// The loudness-measurement cache namespace for a filter chain. Click-only chains keep the
// name they had before the noise ladder existed, so entries already on disk for the same
// audio stay valid.
export function declickCacheSuffix({ mode, noise }: DeclickConfig): string {
  return `-declick-${mode}${noise !== 'off' ? `-noise-${noise}` : ''}`
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

// The platter rumble every noise step also cuts: two second-order Butterworth highpasses
// at 20 Hz, a fourth-order slope measured on sines at −25 dB at 10 Hz and −49 dB at 5 Hz
// (turntable rumble) against −0.5 dB at 40 Hz and −0.2 dB at 50 Hz (sub and kick). A
// 25 Hz corner took 1.2 dB off 40 Hz, real music in a club track. It rides the noise
// ladder instead of a switch of its own: to the listener it is the same fault, noise the
// record adds, and it costs nothing worth choosing against. Ahead of the click repair, so
// adeclick models the signal without the subsonic swing under it.
const RUMBLE_FILTER = 'highpass=f=20,highpass=f=20'

// The background-noise ladder: ffmpeg's FFT denoiser tracking the track's own noise
// floor (tn=1), three steps picked by ear on a real rip's breakdown. Measured there, each
// takes 2-3 dB more off the 8-16 kHz floor (−3/−5/−7 dB) while the music loses 0.3 dB;
// on a clean digital master all three leave the audio as it was, since the tracked floor
// holds nothing to subtract. Last in the chain, so clicks and the subsonic swing do not
// throw the noise estimate.
function noiseFilter(noise: NoiseMode): string | null {
  if (noise === 'soft') return 'afftdn=nr=10:nf=-62:tn=1'
  if (noise === 'medium') return 'afftdn=nr=18:nf=-60:tn=1'
  if (noise === 'strong') return 'afftdn=nr=26:nf=-58:tn=1'
  return null
}

export function declickFilter({ mode, noise }: DeclickConfig): string | null {
  const denoise = noiseFilter(noise)
  return (
    [denoise ? RUMBLE_FILTER : null, clickFilter(mode), denoise].filter(Boolean).join(',') || null
  )
}
