// The walkthrough scenes as pure functions of progress (0→1). Each one is frozen
// mid-action in the static version — "12/40", "Converting 11/40", the cut already
// placed — so they show the result of something the visitor never sees happen.
// Keeping the state in one frame function per scene means replay, the end state and
// the reduced-motion jump are all the same code path with a different t.

import { DECLICK_MARKS, TAIL_CUT } from './waveforms'

const clamp = (t: number) => Math.min(Math.max(t, 0), 1)

/* ---------------------------------------------------------------- 03 · tagging */

export const TAG_TOTAL = 40
const TAG_FROM = 8
export const TAG_ARTIST = 'Lil Suzy'
export const TAG_FIELDS = ['Factory Team', '135', 'Fm · 9A', '1995'] as const

export interface TagFrame {
  done: number
  activeRow: number
  artist: string
  fields: string[]
}

export function tagFrame(t: number): TagFrame {
  const p = clamp(t)
  // The good name types in over the junk one. The replacement is the scene's whole
  // argument, and a swap that lands in a single frame reads as a rendering glitch
  // rather than as work being done.
  const typed = Math.round(Math.max(0, (p - 0.16) / 0.22) * TAG_ARTIST.length)
  return {
    done: Math.round(TAG_FROM + p * (TAG_TOTAL - TAG_FROM)),
    activeRow: Math.min(2, Math.floor(p * 3.2)),
    artist: TAG_ARTIST.slice(0, Math.min(TAG_ARTIST.length, typed)),
    fields: TAG_FIELDS.map((v, i) => (p > 0.34 + i * 0.08 ? v : '')),
  }
}

/* ---------------------------------------------------------------- 04 · declick */

export interface DeclickFrame {
  playhead: number
  found: number
  hitIndex: number | null
  hearingOriginal: boolean
}

export function declickFrame(t: number): DeclickFrame {
  const p = clamp(t)
  const hit = DECLICK_MARKS.findIndex((m) => Math.abs(p - m) < 0.025)
  return {
    playhead: p,
    // Passed clicks stay counted: the scene claims Surco *found* them, so they have
    // to accumulate rather than blink out behind the playhead.
    found: DECLICK_MARKS.filter((m) => m <= p).length,
    hitIndex: hit === -1 ? null : hit,
    // The copy promises you can hear the repair against the original, so the toggle
    // flips on its own instead of sitting on one side claiming it is possible.
    hearingOriginal: (p > 0.35 && p < 0.55) || (p > 0.75 && p < 0.9),
  }
}

/* ------------------------------------------------------------------- 05 · trim */

export const TRIM_CUT = TAIL_CUT

export interface TrimFrame {
  cut: number
  locked: boolean
}

export function trimFrame(t: number): TrimFrame {
  const p = clamp(t)
  // Slides in from the end, overshoots, then settles back onto the last beat with a
  // damped wobble. That settle IS the magnet the copy promises — without it this is
  // a bar sliding to a stop, which oversells what the text claims.
  const overshoot = (1 - TRIM_CUT) * 0.05
  let cut: number
  if (p < 0.72) {
    cut = 1 - (1 - TRIM_CUT) * (p / 0.72) * 1.05
  } else {
    const q = (p - 0.72) / 0.28
    cut = TRIM_CUT + overshoot * Math.cos(q * 9) * (1 - q) * (1 - q)
  }
  return { cut: Math.max(0, Math.min(1, cut)), locked: p > 0.82 }
}

/* ------------------------------------------------------------------ 06 · batch */

export const BATCH_QUEUE = [
  { name: 'Jill Dreski — Let Me Know', format: 'AIFF' },
  { name: 'Jo-Ann — Always', format: 'AIFF' },
  { name: 'Ken Laszlo — When I Fall In Love', format: 'AIFF' },
  { name: 'Kim Sanders — Ride', format: 'WAV' },
  { name: 'Kriss — Tonight', format: 'FLAC' },
] as const

export const BATCH_TOTAL = 40
const BATCH_FROM = 3
const DESTINATIONS = 4

export type BatchState = 'idle' | 'working' | 'done'

export interface BatchFrame {
  states: BatchState[]
  rowProgress: number
  done: number
  fill: number
  destinationsLit: number
  finished: boolean
}

export function batchFrame(t: number): BatchFrame {
  const p = clamp(t)
  const pos = p * BATCH_QUEUE.length
  return {
    // >= on the upper bound, or the last track sits at "working" forever once the
    // run completes — the queue would end mid-convert with nothing left to convert.
    states: BATCH_QUEUE.map((_, i) => (pos >= i + 1 ? 'done' : pos > i ? 'working' : 'idle')),
    rowProgress: pos % 1,
    done: Math.round(BATCH_FROM + p * (BATCH_TOTAL - BATCH_FROM)),
    fill: p,
    // Destinations only light once there are files to send: that is the order the
    // real app works in, and lighting them early would misdescribe the product.
    destinationsLit: Array.from({ length: DESTINATIONS }, (_, k) => 0.55 + k * 0.07).filter(
      (threshold) => p > threshold,
    ).length,
    finished: p >= 1,
  }
}
