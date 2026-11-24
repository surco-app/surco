import { describe, expect, expectTypeOf, it } from 'vitest'
import { PAIR_RATE } from './pairLag'
import {
  MASTER_EDGES_SECONDS,
  MASTER_RATE,
  masterShiftOf,
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
const SECONDS = 200

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
    const mid = samples(100)
    const { head, tail } = windowsFor(
      old,
      concat(zeros(1.5), old.slice(0, mid), zeros(0.05), old.slice(mid)),
    )
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'drift' })
  })

  // An end that is a different recording means the files are not the same master, so any lag found
  // there is noise and must not move a cue.
  it('leaves them alone when the end is another recording', () => {
    const mid = samples(100)
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
    const mid = samples(100)
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
    const master = bars.map((x, i) => x + 0.207 * shared[i])
    const remaster = master.map((x, i) => x + 0.256 * layer[i])
    const { head, tail } = windowsFor(master, concat(zeros(1.5), remaster))
    expect(replaceShiftOf(head, tail)).toEqual({ unmoved: 'noMatch' })
  })
})

// Another master of the same track cannot line up sample by sample: other EQ, other lead-in, a
// clock a little off. Its loudness contour still follows the same sections and hits, so these
// signals are noise shaped by sections of uneven length and level plus a hit every 0.42 s, which
// keeps the structure from repeating the way a pure loop would.
function random(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function music(seed: number, seconds: number): Float32Array {
  const rnd = random(seed)
  const out = new Float32Array(Math.round(seconds * MASTER_RATE))
  const hitEvery = Math.round(0.42 * MASTER_RATE)
  let sectionEnd = 0
  let level = 0
  for (let i = 0; i < out.length; i++) {
    if (i >= sectionEnd) {
      sectionEnd = i + Math.round((2 + 10 * rnd()) * MASTER_RATE)
      level = 0.1 + 0.9 * rnd()
    }
    const hit = Math.exp(-(i % hitEvery) / (0.03 * MASTER_RATE))
    out[i] = (2 * rnd() - 1) * level * (0.3 + hit)
  }
  return out
}

function lowPass(x: Float32Array): Float32Array {
  const out = new Float32Array(x.length)
  let y = 0
  for (let i = 0; i < x.length; i++) {
    y += 0.3 * (x[i] - y)
    out[i] = y
  }
  return out
}

function slower(x: Float32Array, ppm: number): Float32Array {
  const ratio = 1 + ppm / 1e6
  const out = new Float32Array(Math.floor(x.length * ratio))
  for (let i = 0; i < out.length; i++) {
    const at = i / ratio
    const k = Math.floor(at)
    const f = at - k
    out[i] = x[k] * (1 - f) + (k + 1 < x.length ? x[k + 1] : 0) * f
  }
  return out
}

const masterSamples = (seconds: number) => Math.round(seconds * MASTER_RATE)

describe('masterShiftOf', () => {
  const TRACK_SECONDS = 240
  const old = music(11, TRACK_SECONDS)

  // World of Dreams: the new master starts about 290 ms earlier and is EQ'd differently, so the
  // exact measure finds nothing. Left where they were, its cues sit one hit off the beat.
  it('finds another master that sounds 290 ms earlier', () => {
    const shift = masterShiftOf(old, lowPass(old.slice(masterSamples(0.29))))
    expect(shift).not.toBeNull()
    expect(Math.abs((shift ?? 0) + 290)).toBeLessThanOrEqual(2)
  })

  // Positive means the new file sounds later, as in the exact measure; the DJ programs translate
  // that sign, so a flip throws every cue off by twice the shift.
  it('gives a positive shift when the new master starts 750 ms later', () => {
    const shift = masterShiftOf(old, concat(new Float32Array(masterSamples(0.75)), old))
    expect(shift).not.toBeNull()
    expect(Math.abs((shift ?? 0) - 750)).toBeLessThanOrEqual(2)
  })

  // Two real masters run at slightly different speeds (World of Dreams drifts 30 ms over the
  // track). That drift is far below a beat, so the cues still have to move, by a value between
  // the offsets at head and tail.
  it('still moves a master whose clock runs 100 ppm slow', () => {
    const shift = masterShiftOf(old, slower(old, 100))
    expect(shift).not.toBeNull()
    expect(shift ?? 0).toBeGreaterThanOrEqual(Math.floor(30 * 0.1))
    expect(shift ?? 0).toBeLessThanOrEqual(Math.ceil(TRACK_SECONDS * 0.1))
  })

  // An edit with 4 s cut in the middle lines up before the cut and not after it: any single shift
  // would leave the cues after the cut 4 s off their beat.
  it('refuses an edit with 4 s cut from the middle', () => {
    const mid = masterSamples(TRACK_SECONDS / 2)
    const edit = concat(old.slice(0, mid), old.slice(mid + masterSamples(4)))
    expect(masterShiftOf(old, edit)).toBeNull()
  })

  // A version whose breakdown near the end is other material agrees in five windows and not in
  // the sixth. Five out of six is what a hair-thin wrong peak can also give, and the cues in that
  // breakdown would land on audio that is not there, so one window that finds nothing refuses.
  it('refuses when one window is other material', () => {
    const from = masterSamples(TRACK_SECONDS - 91)
    const to = masterSamples(TRACK_SECONDS - 59)
    const version = old.slice()
    version.set(music(14, TRACK_SECONDS).subarray(from, to), from)
    expect(masterShiftOf(old, version)).toBeNull()
  })

  // A version where one section sits a second late (a bar re-cut there) lines up well in every
  // window, but one of them disagrees by far more than a beat. Averaging it away or ignoring it
  // would leave the cues in that section a second off.
  it('refuses when one window lines up a second off the others', () => {
    const from = masterSamples(TRACK_SECONDS - 91)
    const to = masterSamples(TRACK_SECONDS - 59)
    const version = old.slice()
    version.set(old.subarray(from - masterSamples(1), to - masterSamples(1)), from)
    expect(masterShiftOf(old, version)).toBeNull()
  })

  // Another track shares the tempo but not the sections; whatever lag fits best there is noise,
  // and moving cues to it would wreck them.
  it('refuses another track', () => {
    expect(masterShiftOf(old, music(12, TRACK_SECONDS))).toBeNull()
  })

  // Six windows are what make the measure safe; a track too short to hold them is left unmoved
  // rather than measured on fewer.
  it('refuses a track too short for six windows', () => {
    const short = music(13, 100)
    expect(masterShiftOf(short, short)).toBeNull()
  })

  // Silence lines up with anything, so it cannot say where the new audio sits.
  it('refuses a silent new file', () => {
    expect(masterShiftOf(old, new Float32Array(old.length))).toBeNull()
  })

  // The window edges are what the sweep proved safe on real pairs: a caller that pushed or sorted
  // them in place would change the rule for every later measure without anyone re-running it.
  it('exposes the window edges read-only', () => {
    expectTypeOf(MASTER_EDGES_SECONDS).not.toHaveProperty('push')
  })
})
