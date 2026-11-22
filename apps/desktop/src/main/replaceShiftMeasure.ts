import type { ReplaceShift } from '../shared/replaceShift'
import { correlationAt, lagCorrelations, PAIR_RATE } from './pcmLag'

// Provisional until the sweep of task 4 fixes them on real masters, the peak margin included. The head window has to start
// at least one reach into the track so the new file's search span never begins before zero.
export const REPLACE_REACH_SECONDS = 10
export const REPLACE_HEAD_AT_SECONDS = 30
export const REPLACE_TAIL_BEFORE_END_SECONDS = 30
export const REPLACE_TOLERANCE_MS = 2
export const REPLACE_MIN_CORRELATION = 0.9
export const REPLACE_WINDOW_SECONDS = 5
export const REPLACE_PEAK_MARGIN = 0.05
export const REPLACE_PEAK_EXCLUDE_MS = 50

// `old` is REPLACE_WINDOW_SECONDS of the old file from an instant t; `new` is the new file from
// t − REPLACE_REACH_SECONDS, one reach longer on each side, both mono at PAIR_RATE.
export interface ReplaceWindow {
  old: Float32Array
  new: Float32Array
}

// The shift in ms (positive = the new file sounds later) of one window, or null when the window
// is silent, cut shorter than the search needs, or the best lag still does not look like the same
// audio: a lag found on a different recording is the best of noise, and moving cues to it is
// worse than not moving them. Also null when another lag at least REPLACE_PEAK_EXCLUDE_MS away
// fits nearly as well: on a looped intro every bar lines up, head and tail can agree on the same
// wrong bar, and the cues would land whole bars off.
export function windowLagMs(w: ReplaceWindow): number | null {
  const reach = REPLACE_REACH_SECONDS * PAIR_RATE
  if (w.new.length !== w.old.length + 2 * reach) return null
  const padded = new Float32Array(w.new.length)
  padded.set(w.old, reach)
  const curve = lagCorrelations(padded, w.new, reach, reach)
  if (!curve) return null
  let best = 0
  for (let k = 1; k < curve.length; k++) if (curve[k] > curve[best]) best = k
  const lag = best - reach
  const correlation = correlationAt(w.old, 0, w.new, reach + lag, w.old.length)
  if (correlation === null || correlation < REPLACE_MIN_CORRELATION) return null
  const exclude = Math.round((REPLACE_PEAK_EXCLUDE_MS * PAIR_RATE) / 1000)
  let rival = -1
  for (let k = 0; k < curve.length; k++) {
    if (Math.abs(k - best) > exclude && curve[k] > rival) rival = curve[k]
  }
  if (rival >= Math.min(REPLACE_MIN_CORRELATION, curve[best] - REPLACE_PEAK_MARGIN)) return null
  return (lag * 1000) / PAIR_RATE
}

// Only a head and a tail that agree move the cues: one window alone cannot rule out an edit
// further into the track, and a cue a few tens of ms off is audible in the booth.
export function replaceShiftOf(
  head: ReplaceWindow | null,
  tail: ReplaceWindow | null,
): ReplaceShift {
  if (!head || !tail) return { unmoved: 'noMatch' }
  const headMs = windowLagMs(head)
  const tailMs = windowLagMs(tail)
  if (headMs === null || tailMs === null) return { unmoved: 'noMatch' }
  if (Math.abs(headMs - tailMs) > REPLACE_TOLERANCE_MS) return { unmoved: 'drift' }
  return { moved: Math.round(headMs) }
}
