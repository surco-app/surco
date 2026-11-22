import { describe, expect, it } from 'vitest'
import { PAIR_RATE } from './pcmLag'
import {
  REPLACE_HEAD_AT_SECONDS,
  REPLACE_REACH_SECONDS,
  REPLACE_TAIL_BEFORE_END_SECONDS,
  REPLACE_TOLERANCE_MS,
  REPLACE_WINDOW_SECONDS,
  type ReplaceWindow,
  replaceShiftOf,
} from './replaceShiftMeasure'

// When a DJ swaps a file for a better master, the cues they placed on the old one only stay on
// the beat if the new audio sits at the same time or we move them by exactly the measured shift.
// These tests pin both the sign of that shift and the cases where moving would be a guess.
const SECONDS = 120

function noise(seed: number, seconds = SECONDS): Float32Array {
  const out = new Float32Array(Math.round(seconds * PAIR_RATE))
  let s = seed >>> 0
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = s / 2 ** 31 - 1
  }
  return out
}

function loop(cell: Float32Array, seconds: number): Float32Array {
  const out = new Float32Array(seconds * PAIR_RATE)
  for (let i = 0; i < out.length; i++) out[i] = cell[i % cell.length]
  return out
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

const zeros = (seconds: number) => new Float32Array(Math.round(seconds * PAIR_RATE))
const samples = (seconds: number) => Math.round(seconds * PAIR_RATE)

function windowFor(source: Float32Array, newSource: Float32Array, tSec: number): ReplaceWindow {
  const t = samples(tSec)
  const reach = samples(REPLACE_REACH_SECONDS)
  const width = samples(REPLACE_WINDOW_SECONDS)
  const fresh = new Float32Array(width + 2 * reach)
  for (let i = 0; i < fresh.length; i++) {
    const j = t - reach + i
    if (j >= 0 && j < newSource.length) fresh[i] = newSource[j]
  }
  return { old: source.slice(t, t + width), new: fresh }
}

function windowsFor(source: Float32Array, newSource: Float32Array) {
  return {
    head: windowFor(source, newSource, REPLACE_HEAD_AT_SECONDS),
    tail: windowFor(source, newSource, source.length / PAIR_RATE - REPLACE_TAIL_BEFORE_END_SECONDS),
  }
}

describe('replaceShiftOf', () => {
  const old = noise(1)

  // Positive means the new master sounds later: a kick at t in the old file is at t + moved in the
  // new one. That is the sign the five DJ programs translate, so a flipped sign throws every cue off
  // by twice the shift.
  it('moves the cues later when the new master starts 1.5 s later', () => {
    const { head, tail } = windowsFor(old, concat(zeros(1.5), old))
    expect(replaceShiftOf(head, tail)).toEqual({ moved: 1500 })
  })

  // A master with a shorter lead-in brings every kick earlier, so the cues must come earlier too or
  // they all land 750 ms after their beat.
  it('moves them earlier when the new master lost 750 ms of lead-in', () => {
    const { head, tail } = windowsFor(old, old.slice(samples(0.75)))
    expect(replaceShiftOf(head, tail)).toEqual({ moved: -750 })
  })

  // Moving with a doubtful measure is the anti-goal: a cue 50 ms off is audible in the booth, so when
  // the end disagrees with the start (another edit) the DJ's cues stay where they were.
  it('leaves the cues alone when the end does not line up with the start', () => {
    const mid = samples(60)
    const { head, tail } = windowsFor(
      old,
      concat(zeros(1.5), old.slice(0, mid), zeros(0.05), old.slice(mid)),
    )
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'drift' })
  })

  // An end that is a different recording means the files are not the same master, so any lag found
  // there is noise and must not move a cue.
  it('leaves them alone when the end is another recording', () => {
    const mid = samples(60)
    const { head, tail } = windowsFor(
      old,
      concat(zeros(1.5), old.slice(0, mid), noise(2).slice(mid)),
    )
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })

  // Silence lines up with anything, so a silent start cannot tell us where the new audio sits.
  it('leaves them alone when the start window is silent', () => {
    const silentHead = old.slice()
    silentHead.fill(
      0,
      samples(REPLACE_HEAD_AT_SECONDS),
      samples(REPLACE_HEAD_AT_SECONDS + REPLACE_WINDOW_SECONDS),
    )
    const { head, tail } = windowsFor(silentHead, concat(zeros(1.5), silentHead))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })

  // A shift beyond the search reach is never found; the best lag inside the reach is a false match
  // that must be rejected rather than moving the cues to it.
  it('leaves them alone when the move is beyond the reach', () => {
    const { head, tail } = windowsFor(old, concat(zeros(12), old))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })

  // A track too short for both windows has no second opinion, and one window alone cannot rule out
  // an edit further on.
  it('leaves them alone when a window is missing because the track is short', () => {
    const { head } = windowsFor(old, concat(zeros(1.5), old))
    expect(replaceShiftOf(head, null)).toEqual({ unmoved: 'noMatch' })
  })

  // Two windows a sample or two apart are the same placement; refusing them would leave cues behind
  // on files that are simply the same master re-encoded. The gap is the tolerance in whole samples.
  it('accepts two windows that agree within the tolerance', () => {
    const mid = samples(60)
    const gap = new Float32Array(Math.floor((REPLACE_TOLERANCE_MS * PAIR_RATE) / 1000))
    const { head, tail } = windowsFor(
      old,
      concat(zeros(1.5), old.slice(0, mid), gap, old.slice(mid)),
    )
    expect(replaceShiftOf(head, tail)).toEqual({ moved: 1500 })
  })

  // DJ intros and outros are loops of whole bars, exactly where the head and tail windows sit.
  // Every lag a bar apart fits as well as the true one there, and head and tail would agree on the
  // same wrong bar, throwing every cue off by whole bars. Refuse rather than pick one.
  it('leaves them alone when the audio is an exact loop within the reach', () => {
    const looped = loop(noise(3, 1.875), SECONDS)
    const { head, tail } = windowsFor(looped, concat(zeros(1.5), looped))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })

  // A beat-long loop (120 BPM) with a little noise on top is still ambiguous: lags a beat apart
  // correlate far above the threshold, so the measure cannot tell which beat is the right one.
  it('leaves them alone when the audio repeats every beat', () => {
    const beat = loop(noise(4, 0.5), SECONDS)
    const hiss = noise(5)
    for (let i = 0; i < beat.length; i++) beat[i] += 0.02 * hiss[i]
    const { head, tail } = windowsFor(beat, concat(zeros(1.5), beat))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })

  // A window cut short near the end of a file must give no shift, never throw: a failed measure
  // must not fail the conversion.
  it('leaves them alone when a window was cut shorter than the reach needs', () => {
    const { head, tail } = windowsFor(old, concat(zeros(1.5), old))
    const short = { old: tail.old, new: tail.new.slice(0, samples(12)) }
    expect(replaceShiftOf(head, short)).toEqual({ unmoved: 'noMatch' })
  })

  // A remaster that lays a new layer over a looped intro lowers every bar's fit below the
  // threshold except the true one, which wins by a hair. A hair is not a measure: refuse when the
  // next bar fits within the margin of the best, even if it misses the threshold itself.
  it('leaves them alone when another bar fits nearly as well as the best', () => {
    const bars = loop(noise(6, 1.875), SECONDS)
    const shared = noise(7)
    const layer = noise(8)
    const master = bars.map((x, i) => x + 0.184 * shared[i])
    const remaster = master.map((x, i) => x + 0.433 * layer[i])
    const { head, tail } = windowsFor(master, concat(zeros(1.5), remaster))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })
})
