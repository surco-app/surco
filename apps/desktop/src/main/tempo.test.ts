import { describe, expect, it } from 'vitest'
import { detectBeatgrid, detectBpm } from './tempo'

// The detector runs on mono PCM that ffmpeg has already downmixed and
// resampled to this rate; the tests synthesize signals at the same rate so
// they exercise exactly what production feeds in.
const SR = 11025

// A kick-like click train: a short decaying burst on every beat. This is the
// cleanest possible "music" — if the detector can't nail these, it can't nail
// anything, so the tolerances here (±1 BPM) define the accuracy contract that
// the parabolic peak interpolation exists to meet (integer autocorrelation
// lags alone are ~3 BPM apart in the DJ range).
function clickTrain(bpm: number, seconds: number, offsetSec = 0): Float32Array {
  const samples = new Float32Array(Math.floor(SR * seconds))
  const period = (60 / bpm) * SR
  for (let beat = 0; offsetSec * SR + beat * period < samples.length; beat++) {
    const start = Math.round(offsetSec * SR + beat * period)
    for (let i = 0; i < 64 && start + i < samples.length; i++) {
      samples[start + i] = 1 - i / 64
    }
  }
  return samples
}

// Deterministic white noise (LCG, fixed seed) — energy everywhere but no
// periodicity. Math.random would make the confidence threshold test flaky.
function noise(seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SR * seconds))
  let state = 1
  for (let i = 0; i < samples.length; i++) {
    state = (state * 48271) % 2147483647
    samples[i] = state / 2147483647 - 0.5
  }
  return samples
}

describe('detectBpm', () => {
  it('measures a steady four-on-the-floor click train within ±1 BPM', () => {
    // The core promise: a clean house/techno beat reads as its true tempo,
    // accurately enough that the suggested value is usable as-is.
    const result = detectBpm(clickTrain(120, 30), SR)
    expect(result?.bpm).toBeGreaterThan(119)
    expect(result?.bpm).toBeLessThan(121)
  })

  it('resolves a fast drum & bass tempo near the top of the range', () => {
    // 174 sits close to the 180 BPM search ceiling where autocorrelation lags
    // are shortest and integer-lag error is largest — the case that forces
    // sub-lag interpolation.
    const result = detectBpm(clickTrain(174, 30), SR)
    expect(result?.bpm).toBeGreaterThan(173)
    expect(result?.bpm).toBeLessThan(175)
  })

  it('resolves a non-round tempo, not just grid values', () => {
    // Real records drift off round numbers; the detector must not quantize.
    const result = detectBpm(clickTrain(92, 30), SR)
    expect(result?.bpm).toBeGreaterThan(91)
    expect(result?.bpm).toBeLessThan(93)
  })

  it('folds a tempo above the DJ range to its half-time octave', () => {
    // 200 BPM is outside the 80–180 search range; its autocorrelation still
    // peaks at every multiple of the beat period, so the detector reports the
    // 100 BPM octave. Half/double-time ambiguity is inherent to tempo
    // detection — folding into the DJ range is the convention DJs expect, and
    // the value stays a user-editable suggestion either way.
    const result = detectBpm(clickTrain(200, 30), SR)
    expect(result?.bpm).toBeGreaterThan(99)
    expect(result?.bpm).toBeLessThan(101)
  })

  it('reports clean clicks with high confidence', () => {
    // The confidence figure is what the UI will use to qualify the
    // suggestion; a perfectly periodic signal must score near the top of the
    // scale or the figure means nothing.
    const result = detectBpm(clickTrain(128, 30), SR)
    expect(result?.confidence).toBeGreaterThan(0.5)
  })

  it('returns null for silence instead of inventing a tempo', () => {
    // A silent file has no beat; suggesting one (or dividing by a zero
    // envelope and yielding NaN) would write garbage into the bpm field.
    expect(detectBpm(new Float32Array(SR * 30), SR)).toBeNull()
  })

  it('returns null for unpitched noise instead of a spurious tempo', () => {
    // Aperiodic material (ambient pads, field recordings) must yield "no
    // suggestion" rather than a confident-looking random number — a wrong BPM
    // silently trusted is worse for a DJ than no BPM at all.
    expect(detectBpm(noise(30), SR)).toBeNull()
  })

  it('returns null when the audio is too short to correlate', () => {
    // One second holds barely two beats at 120 BPM — any peak found in that
    // little envelope is noise, so refuse rather than guess.
    expect(detectBpm(clickTrain(120, 1), SR)).toBeNull()
  })
})

// The anchor accuracy contract: ±20 ms. The envelope frames are ~11.6 ms
// apart, so this asserts the fold locates the beat to about a frame — tight
// enough that the ±10 ms nudge buttons in the UI are the finest correction a
// user should ever need after detection.
const ANCHOR_TOL = 0.02

describe('detectBeatgrid', () => {
  it('finds the first-beat anchor of an offset click train', () => {
    // The core promise over detectBpm: not just how fast the beat is, but
    // where it falls — the grid a DJ export needs.
    const result = detectBeatgrid(clickTrain(120, 30, 0.25), SR)
    expect(result?.bpm).toBeGreaterThan(119)
    expect(result?.bpm).toBeLessThan(121)
    expect(result?.anchorSec).toBeGreaterThan(0.25 - ANCHOR_TOL)
    expect(result?.anchorSec).toBeLessThan(0.25 + ANCHOR_TOL)
  })

  it('reports phase, not absolute offset, past one beat', () => {
    // 0.75 s at 120 BPM is a beat and a half: the grid through those clicks
    // has its first non-negative beat at 0.25 s. The anchor is the grid's
    // phase — where beats fall — not where the audio happens to start.
    const result = detectBeatgrid(clickTrain(120, 30, 0.75), SR)
    expect(result?.anchorSec).toBeGreaterThan(0.25 - ANCHOR_TOL)
    expect(result?.anchorSec).toBeLessThan(0.25 + ANCHOR_TOL)
  })

  it('anchors an unshifted train at zero, never wrapped to the period end', () => {
    // Phase is circular, so a beat sitting exactly at the file start can
    // estimate a hair early and fold to just under one period — which the UI
    // then reads as "first beat at 0.41 s" while the user stares at an audible
    // hit at zero. Within a frame of the wrap point the anchor must be zero.
    const result = detectBeatgrid(clickTrain(120, 30), SR)
    expect(result?.anchorSec ?? Number.NaN).toBeLessThan(ANCHOR_TOL)
  })

  it('anchors a non-round tempo', () => {
    // Real records drift off round numbers; the fold must work on the
    // fractional beat period the detector actually reports, not an integer
    // frame count.
    const result = detectBeatgrid(clickTrain(92, 30, 0.4), SR)
    expect(result?.anchorSec).toBeGreaterThan(0.4 - ANCHOR_TOL)
    expect(result?.anchorSec).toBeLessThan(0.4 + ANCHOR_TOL)
  })

  it('always reports an anchor inside the first beat period', () => {
    // The stored invariant every consumer (overlay math, export offsetting)
    // relies on: the anchor is the FIRST non-negative beat.
    for (const offsetSec of [0, 0.1, 0.33, 0.49, 0.6]) {
      const result = detectBeatgrid(clickTrain(120, 30, offsetSec), SR)
      expect(result).not.toBeNull()
      const anchor = result?.anchorSec ?? Number.NaN
      expect(anchor).toBeGreaterThanOrEqual(0)
      expect(anchor).toBeLessThan(60 / (result?.bpm ?? Number.NaN))
    }
  })

  // The trance failure mode: an off-beat bass stab louder (in full-band flux)
  // than the kick pulled the phase fold onto the off-beat — the grid then sat
  // exactly half a period off every kick (seen on a real 138 BPM remix, ~210 ms
  // constant error). The beat lives in the kick's LOW band, so the fold must
  // listen there.
  it('anchors on the kick, not on a louder off-beat stab', () => {
    const bpm = 138
    const seconds = 30
    const samples = new Float32Array(Math.floor(SR * seconds))
    const period = (60 / bpm) * SR
    for (let beat = 0; beat * period < samples.length; beat++) {
      const kick = Math.round(beat * period)
      for (let i = 0; i < 400 && kick + i < samples.length; i++) {
        samples[kick + i] += 0.7 * Math.sin((2 * Math.PI * 60 * i) / SR) * (1 - i / 400)
      }
      const stab = Math.round((beat + 0.5) * period)
      for (let i = 0; i < 200 && stab + i < samples.length; i++) {
        samples[stab + i] += 1.0 * Math.sin((2 * Math.PI * 3000 * i) / SR) * (1 - i / 200)
      }
    }
    const result = detectBeatgrid(samples, SR)
    const gridPeriod = 60 / (result?.bpm ?? bpm)
    const anchor = result?.anchorSec ?? Number.NaN
    // Kicks sit at phase zero; wrapped-to-period counts as zero too.
    const phaseError = Math.min(anchor, gridPeriod - anchor)
    expect(phaseError).toBeLessThan(ANCHOR_TOL * 2)
  })

  // The hard-dance failure mode (seen on a real 147 BPM rip, grid half a period
  // off): the kick is a LONG distorted burst (a third of the period), so its
  // sustained low-band energy bleeds past both candidates' quarter-beat windows
  // and the energy vote ties — while a bass swell centered on the off-beat adds
  // just as much sub there. Full-band flux favors the sharper off-beat stab.
  // What still separates the sides is the low band's ATTACK: the kick's sub
  // arrives in one frame, the swell's creeps in — the fold must listen to
  // low-band flux when the energy vote is a wash.
  it('anchors on a long kick when off-beat sub energy ties the energy vote', () => {
    const bpm = 138
    const seconds = 30
    const samples = new Float32Array(Math.floor(SR * seconds))
    const period = (60 / bpm) * SR
    for (let beat = 0; beat * period < samples.length; beat++) {
      // The kick: sharp sub attack, long body — a quarter of the period.
      const kick = Math.round(beat * period)
      const kickLen = Math.round(period * 0.25)
      for (let i = 0; i < kickLen && kick + i < samples.length; i++) {
        samples[kick + i] += 0.75 * Math.sin((2 * Math.PI * 55 * i) / SR) * (1 - i / kickLen)
      }
      // The off-beat stab: louder, sharper, no sub — what full-band flux locks onto.
      const stab = Math.round((beat + 0.5) * period)
      const stabLen = Math.round(period * 0.08)
      for (let i = 0; i < stabLen && stab + i < samples.length; i++) {
        samples[stab + i] += 1.2 * Math.sin((2 * Math.PI * 3000 * i) / SR) * (1 - i / stabLen)
      }
      // The sub swell: a triangle of 55 Hz centered on the off-beat, ramping in
      // and out — as much low-band ENERGY as the kick, next to no low-band flux.
      const swellStart = Math.round((beat + 0.3) * period)
      const swellLen = Math.round(period * 0.4)
      for (let i = 0; i < swellLen && swellStart + i < samples.length; i++) {
        const ramp = 1 - Math.abs(i - swellLen / 2) / (swellLen / 2)
        samples[swellStart + i] += 0.7 * ramp * Math.sin((2 * Math.PI * 55 * i) / SR)
      }
    }
    const result = detectBeatgrid(samples, SR)
    const gridPeriod = 60 / (result?.bpm ?? bpm)
    const anchor = result?.anchorSec ?? Number.NaN
    const phaseError = Math.min(anchor, gridPeriod - anchor)
    expect(phaseError).toBeLessThan(ANCHOR_TOL * 2)
  })

  // Two identical hit trains half a period apart are a genuine coin flip: the
  // review signals must say so, so the triage can park the track for an ear
  // check instead of trusting either side silently.
  it('reports a coin-flip grid as ambiguous with no energy margin', () => {
    const samples = new Float32Array(SR * 30)
    const period = (60 / 120) * SR
    for (let beat = 0; beat * period < samples.length; beat++) {
      for (const off of [0, 0.5]) {
        const start = Math.round((beat + off) * period)
        for (let i = 0; i < 64 && start + i < samples.length; i++) samples[start + i] += 1 - i / 64
      }
    }
    const result = detectBeatgrid(samples, SR)
    expect(result?.phaseAmbiguity ?? 0).toBeGreaterThan(0.8)
    expect(result?.phaseMargin ?? 99).toBeLessThan(1.2)
  })

  it('reports a clean beat as unambiguous', () => {
    const result = detectBeatgrid(clickTrain(120, 30), SR)
    expect(result?.phaseAmbiguity ?? 1).toBeLessThan(0.3)
  })

  it('refuses whatever detectBpm refuses', () => {
    // No tempo means no grid: an anchor without a trustworthy period would
    // draw confident-looking lines through beatless audio.
    expect(detectBeatgrid(new Float32Array(SR * 30), SR)).toBeNull()
    expect(detectBeatgrid(clickTrain(120, 1), SR)).toBeNull()
  })
})
