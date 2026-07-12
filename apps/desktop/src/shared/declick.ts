// The click-repair configuration and its one translation into an ffmpeg filter.
// Lives in shared because the renderer shows the exact applied filter string under
// the controls (the "what values am I applying" transparency line) and main builds
// the conversion with it — one definition, so the shown string can never drift
// from the executed one.
import type { DeclickConfig } from './types'

// Full sensitivity = adeclick's own default threshold; that IS the ceiling.
export const DECLICK_MAX_SENSITIVITY = 5
export const DECLICK_MIN_SENSITIVITY = 1

export const DEFAULT_DECLICK: DeclickConfig = { mode: 'off', sensitivity: DECLICK_MAX_SENSITIVITY }

const MODES = ['off', 'standard', 'strong'] as const

// Repairs any stored value into a valid config: settings written by 0.49-0.50 hold
// the mode as a bare string (upgraded to that mode at full sensitivity), and a
// hand-edited file is repaired field by field — same contract as
// normalizeEditorSections.
export function normalizeDeclick(value: unknown): DeclickConfig {
  if (typeof value === 'string') {
    return MODES.includes(value as DeclickConfig['mode'])
      ? { mode: value as DeclickConfig['mode'], sensitivity: DECLICK_MAX_SENSITIVITY }
      : DEFAULT_DECLICK
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_DECLICK
  const v = value as Partial<DeclickConfig>
  const mode = MODES.includes(v.mode as DeclickConfig['mode'])
    ? (v.mode as DeclickConfig['mode'])
    : DEFAULT_DECLICK.mode
  const sensitivity =
    typeof v.sensitivity === 'number' &&
    Number.isInteger(v.sensitivity) &&
    v.sensitivity >= DECLICK_MIN_SENSITIVITY &&
    v.sensitivity <= DECLICK_MAX_SENSITIVITY
      ? v.sensitivity
      : DECLICK_MAX_SENSITIVITY
  return { mode, sensitivity }
}

// The -af stage for a config. Mode picks the burst fusion: 'standard' is adeclick's
// defaults (fully repairs 1-2 sample stylus clicks), 'strong' raises fusion to the
// MINIMUM that also repairs long pops (b=3 leaves them, b=4 removes them; b≥6
// runs slower than realtime on dense music — never raise it).
//
// Sensitivity maps inversely onto the detection threshold, and only UPWARD from
// adeclick's default (5 → t=2 … 1 → t=6): t below 2 explodes the interpolation
// cost past realtime ("hung" conversions, twice), while raising it is measured
// safe — synthetic clicks still repair fully at t=6, and on clean commercial
// tracks the touched share falls from 6.3% (t=2) to 0.45% (t=4). The audition's
// share caption is the feedback loop this slider exists for.
export function declickFilter(cfg: DeclickConfig): string | null {
  if (cfg.mode === 'off') return null
  const sensitivity = Math.min(
    DECLICK_MAX_SENSITIVITY,
    Math.max(DECLICK_MIN_SENSITIVITY, Math.round(cfg.sensitivity)),
  )
  const threshold = 2 + (DECLICK_MAX_SENSITIVITY - sensitivity)
  const params = [
    ...(threshold > 2 ? [`t=${threshold}`] : []),
    ...(cfg.mode === 'strong' ? ['b=4'] : []),
  ]
  return params.length > 0 ? `adeclick=${params.join(':')}` : 'adeclick'
}
