import { describe, expect, it } from 'vitest'
import { detectBpm } from './tempo'

// The detector runs on mono PCM that ffmpeg has already downmixed and
// resampled to this rate; the tests synthesize signals at the same rate so
// they exercise exactly what production feeds in.
const SR = 11025

// A kick-like click train: a short decaying burst on every beat. This is the
// cleanest possible "music" — if the detector can't nail these, it can't nail
// anything, so the tolerances here (±1 BPM) define the accuracy contract that
// the parabolic peak interpolation exists to meet (integer autocorrelation
// lags alone are ~3 BPM apart in the DJ range).
function clickTrain(bpm: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SR * seconds))
  const period = (60 / bpm) * SR
  for (let beat = 0; beat * period < samples.length; beat++) {
    const start = Math.round(beat * period)
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
