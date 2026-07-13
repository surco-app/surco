// Estimates the tempo of mono PCM by autocorrelating its onset envelope. The
// envelope (half-wave rectified energy flux) spikes on every percussive hit;
// for a steady beat those spikes repeat at the beat period, so the envelope's
// autocorrelation peaks there. We search only lags inside the DJ tempo range
// and report the strongest peak — pure DSP in plain JS, so it needs no native
// binary beyond the ffmpeg decode that produces the PCM, and it unit-tests on
// synthesized signals without spawning anything.

import type { BeatgridResult, BpmResult } from '../shared/types'
import { snapAnchor } from '../shared/beatgrid'

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

// The band the beat-vs-off-beat vote listens to: the kick's body lives below
// this, and where the LOW-band ENERGY peaks within the beat period is the kick
// side. Flux alone can't be trusted for the side — in sidechained dance music
// the mix swells right before the kick (small rise at the kick) while the
// off-beat bass enters from the duck's silence (huge rise), so every flux fold
// locks exactly half a period off the kicks (seen on a real 138 BPM remix).
const KICK_LOWPASS_HZ = 150

// One-pole low-pass, good enough to isolate the kick band for the fold — the
// slow 6 dB/oct rolloff still attenuates a 3 kHz stab by ~26 dB.
function lowpassed(samples: Float32Array, sampleRate: number): Float32Array {
  const a = 1 - Math.exp((-2 * Math.PI * KICK_LOWPASS_HZ) / sampleRate)
  const out = new Float32Array(samples.length)
  let acc = 0
  for (let i = 0; i < samples.length; i++) {
    acc += a * (samples[i] - acc)
    out[i] = acc
  }
  return out
}

// RMS energy per hop — the fold's coarse "which side of the beat" signal.
function energyEnvelope(samples: Float32Array): Float32Array {
  const frames = Math.floor(samples.length / HOP)
  const energy = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += samples[i] * samples[i]
    energy[f] = Math.sqrt(sum / HOP)
  }
  return energy
}

// Half-wave rectified energy flux per hop: rising energy only, so it spikes on
// every percussive hit. Decays and sustains carry no beat information and
// would smear both the correlation peaks and the phase fold.
function onsetEnvelope(samples: Float32Array): Float32Array {
  const energy = energyEnvelope(samples)
  const env = new Float32Array(energy.length)
  for (let f = 1; f < energy.length; f++) env[f] = Math.max(0, energy[f] - energy[f - 1])
  return env
}

export function detectBpm(samples: Float32Array, sampleRate: number): BpmResult | null {
  const fps = sampleRate / HOP
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM)
  const env = onsetEnvelope(samples)
  const frames = env.length
  // Fewer than ~8 beat periods of envelope can't average out spurious
  // correlations; refuse rather than guess from a clip that short.
  if (frames < maxLag * 8) return null

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

  // Compare candidate lags by their parabola-vertex height, not the raw integer
  // sample: a tempo whose true period falls near half a frame (138 BPM is 37.45
  // frames here) splits its peak across two lags, and the raw scan then loses to
  // a subharmonic that happens to land near-integer — a 138 trance track used to
  // read as 92. The vertex restores the split peak's real height.
  let bestLag = -1
  let bestValue = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const value = acf[lag]
    if (value < acf[lag - 1] || value < acf[lag + 1]) continue
    const denom = acf[lag - 1] - 2 * value + acf[lag + 1]
    const vertex = denom < 0 ? value - (acf[lag - 1] - acf[lag + 1]) ** 2 / (8 * denom) : value
    if (vertex > bestValue) {
      bestValue = vertex
      bestLag = lag
    }
  }
  if (bestLag < 0 || bestValue < MIN_CONFIDENCE) return null

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

  // A hit pattern alternating strong and weak (kick plus off-beat bass, the
  // trance staple) correlates at 1.5× the beat period almost as high as at the
  // period itself, and lag quantization can hand 1.5× the win — a 138 BPM track
  // reading as 92. The tell: a REAL beat at this lag leaves nothing at two
  // thirds of it, so a strong peak there means the shorter period is the beat.
  const twoThirds = Math.round((bestLag * 2) / 3)
  if (twoThirds >= minLag) {
    let subLag = twoThirds
    let subValue = -Infinity
    for (let lag = twoThirds - 2; lag <= twoThirds + 2; lag++) {
      const value = acfAt(lag)
      if (value > subValue) {
        subValue = value
        subLag = lag
      }
    }
    if (subValue > 0.6 * bestValue) {
      bestLag = subLag
      bestValue = subValue
    }
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

// Locates the beat phase for the tempo detectBpm found, by folding the onset
// envelope onto the beat period: every frame's flux lands in the bin of its
// position within a beat, and with a steady beat one bin towers over the rest.
// The fold uses the raw rectified envelope, not the mean-subtracted one the
// autocorrelation needs — phase energy must stay non-negative or off-beat bins
// could cancel the peak. Recomputing the envelope costs one O(samples) pass,
// noise next to the O(frames·lags) autocorrelation detectBpm just ran.
export function detectBeatgrid(
  samples: Float32Array,
  sampleRate: number,
): BeatgridResult | null {
  const result = detectBpm(samples, sampleRate)
  if (!result) return null

  const fps = sampleRate / HOP
  const period = (60 * fps) / result.bpm
  const bins = Math.ceil(period)
  const foldOf = (values: Float32Array): Float64Array => {
    const fold = new Float64Array(bins)
    for (let f = 0; f < values.length; f++) {
      const phase = f % period
      fold[Math.min(bins - 1, Math.floor((phase / period) * bins))] += values[f]
    }
    return fold
  }

  // Two signals, two jobs. FLUX localizes precisely (it spikes at the attack)
  // but can't tell beat from off-beat under sidechain pumping; low-band ENERGY
  // knows which half of the period holds the kick (its body is the loudest sub
  // content) but smears across the kick's tail. So: flux proposes the phase and
  // its half-period rival, energy votes between them, flux places the line.
  const fold = foldOf(onsetEnvelope(samples))
  let best = 0
  for (let b = 1; b < bins; b++) if (fold[b] > fold[best]) best = b

  const energyFold = foldOf(energyEnvelope(lowpassed(samples, sampleRate)))
  let energyBest = 0
  let energyTotal = 0
  for (let b = 0; b < bins; b++) {
    energyTotal += energyFold[b]
    if (energyFold[b] > energyFold[energyBest]) energyBest = b
  }
  const circDist = (a: number, b: number): number => {
    const d = Math.abs(a - b)
    return Math.min(d, bins - d)
  }
  // Only vote when the low band actually pulses (flat = beatless bass, keep
  // flux's pick), and re-localize on the rival's own flux peak when it wins.
  if (energyFold[energyBest] * bins > 1.2 * energyTotal) {
    const rival = (best + Math.round(bins / 2)) % bins
    if (circDist(rival, energyBest) < circDist(best, energyBest)) {
      let peak = rival
      for (let d = -2; d <= 2; d++) {
        const b = (rival + d + bins) % bins
        if (fold[b] > fold[peak]) peak = b
      }
      best = peak
    }
  }

  // Sub-bin refinement over circular neighbours, same parabola as the
  // autocorrelation's. A frame is ~11.6 ms; without this the anchor quantizes
  // to frames and the ±20 ms accuracy contract gets no margin.
  const before = fold[(best - 1 + bins) % bins]
  const after = fold[(best + 1) % bins]
  const denom = before - 2 * fold[best] + after
  const offset = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / denom))

  // +0.5 reads the bin at its centre: a hit anywhere inside frame f folds into
  // bin f, so the unbiased estimate of where it struck is mid-frame.
  const phaseFrames = ((best + 0.5 + offset) / bins) * period
  const folded = snapAnchor((phaseFrames * HOP) / sampleRate, result.bpm)
  // Phase is circular: a beat sitting exactly at the file start can estimate a
  // hair early and fold to just under one period — the UI then says "first beat
  // at 0.41 s" while the user stares at an audible hit at zero. Within a frame
  // of the wrap point, the honest anchor is the file start itself.
  const periodSec = 60 / result.bpm
  const anchorSec = periodSec - folded < (1.5 * HOP) / sampleRate ? 0 : folded
  return { bpm: result.bpm, confidence: result.confidence, anchorSec }
}
