import type { ReplaceShift } from '../shared/replaceShift'
import { correlationAt, lagCorrelations, PAIR_RATE } from './pairLag'

// Fixed by replaceShiftSweep.test.ts (22/11) on 234 real same-track pairs (12 kept originals, 75
// Apple Music/rekordbox copies, 147 downloads against their Apple Music copy) and two negative
// controls (233 random cross pairs, 5 Matching pairs). 176 positives agree on one shift in every
// window; the largest real one is 4.45 s, so a 5 s reach covers it, and a wider reach only finds
// more bars of the same loop: at 30 s a radio edit matched its extended mix 26.7 s off. Intros and
// outros are loops, so the windows sit deep inside: at 30 s from either end 73 of 234 pairs came
// out ambiguous, at 90 s 17. The pairs that line up in both windows differ by at most 0.98 ms
// (a 4 ppm clock drift), hence 2 ms; the one pair at 7.85 ms is an edit (a constant step between
// head and tail) and has to stay unmoved. No negative window got past 0.65, so 0.95 costs nothing
// there and, as the ceiling of the rival test, lets a looped bar at 0.9 to 0.95 stand beside a
// true peak above it by the margin. With these, 156 of 234 move (all to the shift every window
// agrees on), 58 are another master, 17 ambiguous, 2 too short, 1 drift; no negative pair moves.
// The head window has to start at least one reach into the track so the new file's search span
// never begins before zero.
export const REPLACE_REACH_SECONDS = 5
export const REPLACE_HEAD_AT_SECONDS = 90
export const REPLACE_TAIL_BEFORE_END_SECONDS = 90
export const REPLACE_TOLERANCE_MS = 2
export const REPLACE_MIN_CORRELATION = 0.95
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

// Another master of the same track (other lead-in, other EQ, a clock a little off) never lines up
// sample by sample, but its loudness contour does. Fixed by a prototype (24/11) on the pairs of
// replaceShiftSweep.test.ts: 163 the exact measure already aligns, 58 same-track pairs it does
// not, and 424 negatives (419 random, 5 Matching). A 10 ms log-RMS envelope over 30 s windows,
// searched ±5 s, then refined to 1 ms on an onset envelope within ±60 ms, moved 159 of the 163
// exact pairs with at most 0.43 ms of error against the sample-exact truth, 19 of the 58 others
// and World of Dreams (about −275 ms), and none of the 424 negatives, where at most 2 of 6 windows
// ever agreed within 50 ms. One or two windows are not enough: in World of Dreams the right peak
// beats the one a hit earlier (−710 ms) by only 0.015 to 0.03, so the safety comes from all six
// windows agreeing, not from a margin. Windows start 30, 60 and 90 s in and end 30, 60 and 90 s
// before the end, deep enough that the intro and outro loops stay out; pairs whose drift grows
// past 50 ms (another speed) and edits (a step between windows) stay unmoved, as they should.
export const MASTER_RATE = 4000
export const MASTER_WINDOW_SECONDS = 30
export const MASTER_REACH_SECONDS = 5
export const MASTER_EDGES_SECONDS = [30, 60, 90] as const
export const MASTER_MIN_CORRELATION = 0.5
export const MASTER_TOLERANCE_MS = 50
export const MASTER_FINE_REACH_MS = 60

const COARSE_BLOCK_MS = 10
const FINE_BLOCK_MS = 1

function blockRms(x: Float32Array, blockMs: number): Float64Array {
  const block = Math.round((MASTER_RATE * blockMs) / 1000)
  const out = new Float64Array(Math.floor(x.length / block))
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (let j = 0; j < block; j++) sum += x[i * block + j] ** 2
    out[i] = Math.sqrt(sum / block)
  }
  return out
}

// The log keeps a quiet section's contour as telling as a loud one's, and the floor keeps
// silence from going to −∞.
function loudness(x: Float32Array): Float64Array {
  return blockRms(x, COARSE_BLOCK_MS).map((r) => Math.log(r + 1e-4))
}

// Only rises in level mark a hit; two masters differ far more in how a hit decays than in where
// it starts.
function onsets(x: Float32Array): Float64Array {
  const rms = blockRms(x, FINE_BLOCK_MS)
  const out = new Float64Array(rms.length)
  for (let i = 1; i < rms.length; i++) out[i] = Math.max(0, rms[i] - rms[i - 1])
  return out
}

// Silence has no variance and fits nothing, so it scores the worst correlation.
function pearson(a: Float64Array, a0: number, b: Float64Array, b0: number, n: number): number {
  let sa = 0
  let sb = 0
  let sab = 0
  let saa = 0
  let sbb = 0
  for (let i = 0; i < n; i++) {
    const x = a[a0 + i]
    const y = b[b0 + i]
    sa += x
    sb += y
    sab += x * y
    saa += x * x
    sbb += y * y
  }
  const variance = (saa - (sa * sa) / n) * (sbb - (sb * sb) / n)
  return variance > 0 ? (sab - (sa * sb) / n) / Math.sqrt(variance) : -1
}

function bestLag(
  a: Float64Array,
  start: number,
  b: Float64Array,
  n: number,
  from: number,
  to: number,
): { lag: number; correlation: number } | null {
  let best: { lag: number; correlation: number } | null = null
  for (let lag = from; lag <= to; lag++) {
    const b0 = start + lag
    if (b0 < 0 || b0 + n > b.length) continue
    const correlation = pearson(a, start, b, b0, n)
    if (!best || correlation > best.correlation) best = { lag, correlation }
  }
  return best
}

// The shift in ms (positive = the new file sounds later) when `current` is another master of
// `old`, or null unless all six windows find the same audio within MASTER_TOLERANCE_MS. Both are
// the whole file, mono at MASTER_RATE.
export function masterShiftOf(old: Float32Array, current: Float32Array): number | null {
  const seconds = old.length / MASTER_RATE
  const starts = [
    ...MASTER_EDGES_SECONDS,
    ...MASTER_EDGES_SECONDS.map((edge) => seconds - edge - MASTER_WINDOW_SECONDS),
  ]
  const coarseOld = loudness(old)
  const coarseNew = loudness(current)
  const fineOld = onsets(old)
  const fineNew = onsets(current)
  const perSecondCoarse = 1000 / COARSE_BLOCK_MS
  const perSecondFine = 1000 / FINE_BLOCK_MS
  const reach = MASTER_REACH_SECONDS * perSecondCoarse
  const fines: number[] = []
  for (const start of starts) {
    if (start < 0 || start + MASTER_WINDOW_SECONDS > seconds) return null
    const coarse = bestLag(
      coarseOld,
      Math.round(start * perSecondCoarse),
      coarseNew,
      MASTER_WINDOW_SECONDS * perSecondCoarse,
      -reach,
      reach,
    )
    if (!coarse || coarse.correlation < MASTER_MIN_CORRELATION) return null
    const centre = coarse.lag * COARSE_BLOCK_MS
    const fine = bestLag(
      fineOld,
      Math.round(start * perSecondFine),
      fineNew,
      MASTER_WINDOW_SECONDS * perSecondFine,
      centre - MASTER_FINE_REACH_MS,
      centre + MASTER_FINE_REACH_MS,
    )
    if (!fine) return null
    fines.push(fine.lag * FINE_BLOCK_MS)
  }
  if (Math.max(...fines) - Math.min(...fines) > MASTER_TOLERANCE_MS) return null
  return Math.round(fines.reduce((sum, ms) => sum + ms, 0) / fines.length)
}
