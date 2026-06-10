// Estimates the tempo of mono PCM by autocorrelating its onset envelope. The
// envelope (half-wave rectified energy flux) spikes on every percussive hit;
// for a steady beat those spikes repeat at the beat period, so the envelope's
// autocorrelation peaks there. We search only lags inside the DJ tempo range
// and report the strongest peak — pure DSP in plain JS, so it needs no native
// binary beyond the ffmpeg decode that produces the PCM, and it unit-tests on
// synthesized signals without spawning anything.

import type { BpmResult } from '../shared/types'

// The rate ffmpeg decodes to before analysis. Beat energy lives far below
// this Nyquist, so a low rate costs no accuracy while keeping minutes of
// mono PCM in the tens of megabytes instead of hundreds at native rates.
export const TEMPO_SAMPLE_RATE = 11025

// Hop size in samples at the analysis rate (11025 Hz → ~86 envelope frames/s).
// Small enough that beat positions resolve to well under a beat period, large
// enough that a 4-minute track is only ~20k frames to correlate.
const HOP = 128

// The search range brackets virtually all dance music; anything outside folds
// to its half/double-time octave inside it (a 200 BPM track autocorrelates at
// every multiple of its beat period, so its 100 BPM octave still peaks).
// Searching wider would let one octave of the same track compete with another.
const MIN_BPM = 80
const MAX_BPM = 180

// Normalized autocorrelation below this means no lag stands out from the
// envelope's own noise — unpitched material (pads, field recordings) scores
// well under it while even a sloppy real beat scores far above. Returning
// null beats suggesting a confident-looking random number.
const MIN_CONFIDENCE = 0.25

export function detectBpm(samples: Float32Array, sampleRate: number): BpmResult | null {
  const fps = sampleRate / HOP
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM)
  const frames = Math.floor(samples.length / HOP)
  // Fewer than ~8 beat periods of envelope can't average out spurious
  // correlations; refuse rather than guess from a clip that short.
  if (frames < maxLag * 8) return null

  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += samples[i] * samples[i]
    energy[f] = Math.sqrt(sum / HOP)
  }

  // Half-wave rectified flux: rising energy only. Decays and sustains carry
  // no beat information and would smear the correlation peaks.
  const env = new Float32Array(frames)
  for (let f = 1; f < frames; f++) env[f] = Math.max(0, energy[f] - energy[f - 1])

  // Remove the mean so the autocorrelation measures periodicity, not the
  // envelope's DC level — without this a busy but beatless signal correlates
  // highly at every lag.
  let mean = 0
  for (let f = 0; f < frames; f++) mean += env[f]
  mean /= frames
  for (let f = 0; f < frames; f++) env[f] -= mean

  let r0 = 0
  for (let f = 0; f < frames; f++) r0 += env[f] * env[f]
  if (r0 === 0) return null

  const acf = new Float32Array(maxLag + 2)
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let sum = 0
    for (let f = 0; f + lag < frames; f++) sum += env[f] * env[f + lag]
    acf[lag] = sum / r0
  }

  let bestLag = -1
  let bestValue = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (acf[lag] > bestValue) {
      bestValue = acf[lag]
      bestLag = lag
    }
  }
  if (bestValue < MIN_CONFIDENCE) return null

  // Integer lags are ~3 BPM apart up at 180, and the envelope's correlation
  // peak is too narrow for a parabola fit alone to recover the fraction
  // reliably. The autocorrelation also peaks at every multiple of the beat
  // period, and locating the k-th peak to ±half a lag pins the period itself
  // to ±1/(2k) — so we walk out to ever more distant multiples, re-predicting
  // each peak's position from the period refined so far. Doubling k stepwise
  // keeps the prediction error (and so the search window) a couple of lags
  // wide; jumping straight to a far multiple would need a window wide enough
  // to swallow a neighbouring peak of the unfolded period when the true tempo
  // sits above the search range.
  const acfAt = (lag: number): number => {
    let sum = 0
    for (let f = 0; f + lag < frames; f++) sum += env[f] * env[f + lag]
    return sum / r0
  }
  const interpolate = (peakLag: number, peakValue: number): number => {
    const before = acfAt(peakLag - 1)
    const after = acfAt(peakLag + 1)
    const denom = before - 2 * peakValue + after
    const offset = denom === 0 ? 0 : (0.5 * (before - after)) / denom
    return peakLag + Math.max(-0.5, Math.min(0.5, offset))
  }

  let period = interpolate(bestLag, bestValue)
  let k = 1
  while (4 * k * period < frames) {
    k *= 2
    const centre = Math.round(k * period)
    let peakLag = centre
    let peakValue = -Infinity
    for (let lag = centre - 4; lag <= centre + 4; lag++) {
      const value = acfAt(lag)
      if (value > peakValue) {
        peakValue = value
        peakLag = lag
      }
    }
    period = interpolate(peakLag, peakValue) / k
  }

  return { bpm: (60 * fps) / period, confidence: Math.min(1, bestValue) }
}
