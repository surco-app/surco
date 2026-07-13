// Estimates the tempo of mono PCM by autocorrelating its onset envelope. The
// envelope (half-wave rectified energy flux) spikes on every percussive hit;
// for a steady beat those spikes repeat at the beat period, so the envelope's
// autocorrelation peaks there. We search only lags inside the DJ tempo range
// and report the strongest peak — pure DSP in plain JS, so it needs no native
// binary beyond the ffmpeg decode that produces the PCM, and it unit-tests on
// synthesized signals without spawning anything.

import type { BeatgridResult, BpmResult, GridChange } from '../shared/types'
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

// The drift scan's granularity: the local phase is measured over windows this
// long, so a step lands on a window boundary at worst this far from where it
// happened. Long enough that a window holds ~20+ beats to average over.
const DRIFT_WINDOW_SEC = 10
// A window must sit this far off its segment's grid — and the NEXT window must
// agree — before a change is emitted. 25 ms is right at beat-matching slop;
// under it a re-anchor is churn, over it the grid audibly walks off the kicks.
const DRIFT_STEP_SEC = 0.025
const DRIFT_CONFIRM_SEC = 0.015
// The first window's local phase outranks the whole-file fold (which averages
// every segment together) — but only past this gate, so frame noise on steady
// tracks never wiggles the anchor that the fold measured globally.
const DRIFT_REBASE_SEC = 0.015

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

// Scans the onset envelope in windows for phase steps against the detected
// grid — the vinyl-rip drift multi-segment grids exist for (a splice, a needle
// bump, slow wow). Each window's local phase is measured on the same circular
// fold the global phase used, searched around the RUNNING phase so slow wow
// stays tracked (unwrapped) even past a quarter period cumulatively. A step
// must clear DRIFT_STEP_SEC and be confirmed by the next measurable window
// before it becomes a change — the guard that keeps arrangement changes and
// noise from growing segments on steady tracks. Cumulative wow re-anchors each
// time the deviation from the CURRENT segment crosses the step threshold.
function detectDrift(
  flux: Float32Array,
  fps: number,
  bpm: number,
  anchorSec: number,
): { anchorSec: number; changes: GridChange[] } {
  const periodSec = 60 / bpm
  const periodFrames = (60 * fps) / bpm
  const bins = Math.ceil(periodFrames)
  const frames = flux.length
  const winFrames = Math.round(DRIFT_WINDOW_SEC * fps)
  if (winFrames <= 0 || frames < winFrames * 2) return { anchorSec, changes: [] }

  const wrap = (sec: number): number => ((sec % periodSec) + periodSec) % periodSec

  // The absolute phase (seconds, unwrapped near refSec) of the strongest pulse
  // in [f0, f1) — or null when the window holds no clear pulse (a breakdown),
  // which simply skips the window instead of feeding noise into the scan.
  const phaseAt = (f0: number, f1: number, refSec: number): number | null => {
    const fold = new Float64Array(bins)
    let total = 0
    for (let f = f0; f < f1; f++) {
      const phase = f % periodFrames
      fold[Math.min(bins - 1, Math.floor((phase / periodFrames) * bins))] += flux[f]
      total += flux[f]
    }
    if (total <= 0) return null
    const refBin = Math.floor((wrap(refSec) / periodSec) * bins)
    const search = Math.max(2, Math.round(bins / 4))
    let peak = -1
    let peakValue = 0
    for (let d = -search; d <= search; d++) {
      const b = (refBin + d + bins) % bins
      if (fold[b] > peakValue) {
        peakValue = fold[b]
        peak = b
      }
    }
    // A real beat towers over the window's average flux; anything flatter is
    // pad wash or noise and must not measure.
    if (peak < 0 || peakValue * bins < 2 * total) return null
    const before = fold[(peak - 1 + bins) % bins]
    const after = fold[(peak + 1) % bins]
    const denom = before - 2 * peakValue + after
    const off = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / denom))
    const measured = (((peak + 0.5 + off) / bins) * periodFrames) / fps
    let delta = measured - wrap(refSec)
    if (delta > periodSec / 2) delta -= periodSec
    if (delta < -periodSec / 2) delta += periodSec
    return refSec + delta
  }

  const phases: (number | null)[] = []
  let searchRef = wrap(anchorSec)
  for (let f0 = 0; f0 + winFrames <= frames; f0 += winFrames) {
    const measured = phaseAt(f0, f0 + winFrames, searchRef)
    phases.push(measured)
    if (measured !== null) searchRef = measured
  }
  const firstIndex = phases.findIndex((m) => m !== null)
  if (firstIndex < 0) return { anchorSec, changes: [] }
  const first = phases[firstIndex] as number

  // The opening windows' own phase outranks the whole-file fold, which
  // averaged every later segment into the anchor — but only past the gate, so
  // frame noise never wiggles a steady track's anchor.
  let base = anchorSec
  if (Math.abs(first - wrap(anchorSec)) > DRIFT_REBASE_SEC)
    base = snapAnchor(anchorSec + (first - wrap(anchorSec)), bpm)

  const changes: GridChange[] = []
  let segPhase = first
  for (let w = firstIndex + 1; w < phases.length; w++) {
    const measured = phases[w]
    if (measured === null) continue
    if (Math.abs(measured - segPhase) <= DRIFT_STEP_SEC) continue
    const next = phases.slice(w + 1).find((x) => x !== null)
    if (next === undefined || next === null || Math.abs(next - measured) > DRIFT_CONFIRM_SEC)
      continue
    // The change lands on the corrected grid's first beat inside this window.
    const windowStartSec = (w * winFrames) / fps
    const anchorAbs = base + (measured - first)
    const k = Math.ceil((windowStartSec - anchorAbs) / periodSec - 1e-6)
    changes.push({ anchorSec: Number((anchorAbs + k * periodSec).toFixed(3)), bpm })
    segPhase = measured
  }
  return { anchorSec: base, changes }
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

  // Three signals, ranked. Full-band FLUX localizes precisely (it spikes at
  // the attack) but can't tell beat from off-beat: sidechain pumping and loud
  // off-beat stabs both hand it the wrong side. The beat belongs to the KICK,
  // and what defines a kick is its sub ATTACK — so low-band FLUX outranks
  // low-band ENERGY, whose sustained reading lies whenever the kick's long
  // distorted body bleeds past the compare windows or an off-beat bass swell
  // carries as much sub as the kick (a real 147 hard-dance rip: energy margin
  // 1.06, low-flux margin 1.50; the trance calibration track agrees, 1.56 with
  // energy 2.02). So: full flux proposes the phase and its half-period rival,
  // the sub's attack arbitrates, the sub's energy settles a wash, and full
  // flux places the line.
  const flux = onsetEnvelope(samples)
  const fold = foldOf(flux)
  let best = 0
  for (let b = 1; b < bins; b++) if (fold[b] > fold[best]) best = b

  const lowSamples = lowpassed(samples, sampleRate)
  const energyFold = foldOf(energyEnvelope(lowSamples))
  const lowFluxFold = foldOf(onsetEnvelope(lowSamples))

  // The winner's half-period rival, re-localized on its own full-flux peak —
  // the arbitration and the review signals both measure against it.
  const rivalPeakOf = (b: number): number => {
    const centre = (b + Math.round(bins / 2)) % bins
    let peak = centre
    for (let d = -2; d <= 2; d++) {
      const c = (centre + d + bins) % bins
      if (fold[c] > fold[peak]) peak = c
    }
    return peak
  }
  const nearWin = Math.max(1, Math.round(bins / 8))
  const near = (values: Float64Array, centre: number): number => {
    let sum = 0
    for (let d = -nearWin; d <= nearWin; d++) sum += values[(centre + d + bins) % bins]
    return sum
  }
  const ratio = (a: number, b: number): number => (b > 0 ? a / b : Number.POSITIVE_INFINITY)

  // A voter must beat the other side by this much to decide a phase; under it
  // the voter abstains (a flat bass drone abstains from both low-band votes by
  // construction). The review margin downstream treats any grid decided at
  // this bar as settled.
  const DECISIVE = 1.3
  let rivalPeak = rivalPeakOf(best)
  const rivalLowFlux = ratio(near(lowFluxFold, rivalPeak), near(lowFluxFold, best))
  if (rivalLowFlux >= DECISIVE) {
    // The rival side holds the sub attacks — the kick lives there.
    best = rivalPeak
    rivalPeak = rivalPeakOf(best)
  } else if (rivalLowFlux >= 1) {
    // The sub-attack vote is a wash — the kick body's sustained energy may
    // settle it, but only while the sub-attack doesn't lean against it: an
    // off-beat swell can hold MORE in-window sub energy than a long kick whose
    // body outruns the window, and letting energy override even a mild attack
    // lean handed that swell the beat.
    if (ratio(near(energyFold, rivalPeak), near(energyFold, best)) >= DECISIVE) {
      best = rivalPeak
      rivalPeak = rivalPeakOf(best)
    }
  }
  // The margin reported for review is the strongest voter's word from the
  // final side: either low-band signal decisively on this side is a settled
  // grid; both hovering near 1 is the coin flip an ear must check.
  const phaseMargin = Math.max(
    ratio(near(lowFluxFold, best), near(lowFluxFold, rivalPeak)),
    ratio(near(energyFold, best), near(energyFold, rivalPeak)),
  )
  const phaseAmbiguity = fold[best] > 0 ? Math.min(1, fold[rivalPeak] / fold[best]) : 0

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

  // The drift scan may re-base the anchor onto the opening windows' phase and
  // add a change per confirmed mid-track step — the automatic counterpart of
  // "Adjust from here". Its anchor gets the same wrap-to-zero read as above.
  const drift = detectDrift(flux, fps, result.bpm, anchorSec)
  const baseAnchor = periodSec - drift.anchorSec < (1.5 * HOP) / sampleRate ? 0 : drift.anchorSec
  return {
    bpm: result.bpm,
    confidence: result.confidence,
    anchorSec: baseAnchor,
    phaseAmbiguity,
    phaseMargin,
    ...(drift.changes.length > 0 ? { changes: drift.changes } : {}),
  }
}
