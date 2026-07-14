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

// A file shorter than two of these holds too little beat to scan for drift at
// all: the tracker's tempo needs room to settle before its readings mean
// anything, and a clip that short has no room for a real tempo change anyway.
const DRIFT_WINDOW_SEC = 10
// The base grid keeps the anchor the whole-file fold measured unless the
// tracked beats disagree by more than this — so frame noise never wiggles the
// anchor of a steady record away from the value the fold reported.
const DRIFT_REBASE_SEC = 0.015

// A segment is FITTED, not just re-anchored: a straight line through its
// tracked beats gives both the tempo (its slope) and the phase (its intercept).
// Correcting the phase while leaving the wrong BPM running underneath — what
// this scan used to do — buys a few bars before the grid walks off the kicks
// again, and a dragging platter then grows a re-anchor every few windows
// without ever fitting.
//
// The floor under overruling the global detection: a tempo this close to what
// the whole-file autocorrelation said is the same reading, and re-stating it
// would only churn the grid of a steady record.
const TEMPO_FIT_MIN_SLOPE = 0.0002
// A stretch shorter than this has no tempo worth trusting — a couple of beats
// fit any line — so it never becomes a segment of its own.
const MIN_SEGMENT_BEATS = 8
// How large a flux peak must be, relative to a TYPICAL onset on this record
// (the 90th percentile of the ones present), before the tracker believes a drum
// was struck there. A breakdown is not silence — a pad swells and wobbles, and
// its flux has local peaks — so without this bar the tracker reports beats
// nobody played straight through the breakdown, follows the pad's phase, and
// lurches the grid when the drums return.
//
// Measured against a percentile rather than the loudest onset because the
// loudest is one frame and every record has outliers: a single crash sets a bar
// the same record's quieter opening cannot clear, and the tracker then silently
// loses every beat before it (a fixture with a loud drop lost its first 43
// beats, anchoring the grid 61 ms off). Swept on the fixtures, every value from
// 0.3 to 1.0 gives identical grids — the percentile, not this number, is what
// makes the bar robust — so it sits mid-plateau.
const ONSET_FLOOR_OF_PEAK = 0.5
// How many beats the tracker may coast through before the beat it finally hears
// counts as a SEAM — the far side of a hole it could not see into, where a
// segment may legitimately begin. A bar or two of no drums is an ordinary drop
// the coast rides out; tens of seconds is a breakdown, and what the record did
// in there is unknown.
const RESEEK_AFTER_BEATS = 8

// How far a beat may sit from its segment's line before the fit cuts a new
// segment there. Deliberately tighter than the ~25 ms of slop a DJ starts to
// hear as a flam: this tolerance is a budget the whole stretch spends, so
// allowing the audible figure here would let a segment end up right at the edge
// of audible once measurement noise stacks on top. Half of it leaves headroom —
// and on the ramped-platter fixture it holds the worst beat to 14 ms.
const SEGMENT_FIT_TOL_SEC = 0.012

// A beat the tracker located, carried with the beat NUMBER it is — not its
// position in the array. The two differ wherever the tracker coasted across a
// breakdown, and the fits read tempo as seconds-per-beat, so they must count in
// real beats or a 30 s hole silently becomes a tempo change. `seam` marks the
// first beat heard after a long hole: what the record did in there was never
// measured, so a segment may legitimately begin at one.
interface TrackedBeat {
  atSec: number
  index: number
  seam: boolean
}

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

// Tracks the beat pulse by pulse across the whole file, then fits the tracked
// beats into the fewest constant-tempo stretches that hold the grid on them.
//
// Why tracking rather than the fold the global phase uses: a fold measures a
// window against ONE assumed period, so the moment the record's real tempo
// differs — the very case a multi-segment grid exists for — the window's beats
// land in different bins and the peak smears away. A deck 4 BPM off slides a
// beat's width every 15 s, which is exactly the reading the fold cannot make.
// Following each beat to where the flux actually peaks near the predicted time,
// and letting the period adapt as it goes, measures the record instead of the
// assumption. Everything downstream (segment cuts, per-segment tempo) is then a
// straight-line fit over honest beat times.
function trackBeats(
  flux: Float32Array,
  fps: number,
  bpm: number,
  anchorSec: number,
): TrackedBeat[] {
  const frames = flux.length
  const period0 = (60 * fps) / bpm
  // How far around the prediction a beat may be hunted, and how fast the
  // tracked period may adapt. A quarter period of search follows any real drift
  // (a platter never lurches that hard between two beats) while never reaching
  // the neighbouring beat, which would let the tracker slip a whole beat and
  // lock onto the off-beat.
  const search = Math.max(1, Math.round(period0 / 4))
  // The period follows the record, but slowly: each beat nudges it by this much
  // of the newly observed interval. Too fast and one syncopated hit drags the
  // tempo; too slow and a real ramp never gets tracked.
  const ADAPT = 0.08

  // What counts as a drum hit on this record. A breakdown is not silence — a
  // pad swells and wobbles, and its flux has local peaks — so a tracker that
  // only asked "is this the biggest frame nearby?" would report beats nobody
  // played straight through the breakdown, follow the pad's phase, and lurch
  // the grid when the drums returned.
  //
  // The bar is a fraction of a TYPICAL onset, not of the loudest one. The
  // loudest is a single frame and any record has outliers: one crash then sets
  // a bar the same record's quieter opening cannot clear, and the tracker
  // silently loses every beat before it (measured: a track with a loud drop lost
  // its first 43 beats, anchoring the grid 61 ms off the kicks). A high
  // percentile of the onsets that exist is robust to both — a crash cannot lift
  // it, a pad cannot reach it.
  const onsets: number[] = []
  for (let f = 0; f < frames; f++) if (flux[f] > 0) onsets.push(flux[f])
  onsets.sort((a, b) => a - b)
  const typicalOnset =
    onsets.length > 0 ? onsets[Math.min(onsets.length - 1, Math.floor(onsets.length * 0.9))] : 0
  const onsetFloor = typicalOnset * ONSET_FLOOR_OF_PEAK

  // The strongest flux frame within `search` of `centre`, refined to sub-frame
  // by the same parabola the folds use. Null means "nothing was struck here" —
  // silence, or a wash that never rises to a hit — and the caller coasts.
  const peakNear = (centre: number): number | null => {
    const lo = Math.max(1, Math.round(centre - search))
    const hi = Math.min(frames - 2, Math.round(centre + search))
    if (lo > hi) return null
    let peak = -1
    let peakValue = 0
    for (let f = lo; f <= hi; f++) {
      if (flux[f] > peakValue) {
        peakValue = flux[f]
        peak = f
      }
    }
    if (peak < 0 || peakValue < onsetFloor) return null
    const before = flux[peak - 1]
    const after = flux[peak + 1]
    const denom = before - 2 * peakValue + after
    const off = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (before - after)) / denom))
    return peak + off
  }

  // Beats carry their INDEX, not just their time, because a breakdown is a hole
  // in the sequence: the tracker coasts across it and finds no beats to record.
  // Numbering only the beats it heard would make the beats on either side of a
  // 30 s hole look adjacent, and the straight-line fit downstream — which reads
  // tempo as seconds-per-beat — would then compute a wildly wrong tempo from a
  // gap it cannot see. Counting every predicted beat, recorded or coasted,
  // keeps index and time in step across any hole.
  const beats: TrackedBeat[] = []
  let period = period0
  let index = 0
  let lastFound: { atFrame: number; index: number } | null = null

  // Start the lattice on a REAL onset — but on one that sits on the side of the
  // beat the phase vote already chose, never simply on the first loud thing in
  // the file. Two failures have to be avoided at once:
  //
  // The fold's phase is a whole-file average, so on a record whose speed slides
  // it can name a phase that fits no part of the track. The tracker then aims
  // each prediction up to a quarter period from where the drum really is, finds
  // nothing inside its search, and coasts — 21 s on the dragging fixture,
  // losing the first 43 beats and anchoring the grid 61 ms off the kicks.
  //
  // But anchoring on the first onset outright hands the grid to whatever is
  // loudest at the top of the file, and in sidechained dance music that is
  // routinely the off-beat stab, not the kick — the very trap the low-band
  // voters upstream exist to escape. So the lattice starts at the first onset
  // that ALSO lands near the chosen phase: the vote keeps the side, the onset
  // supplies a real drum to sit on.
  const foldPhase = ((anchorSec * fps) % period) + (anchorSec < 0 ? period : 0)
  const onPhase = (f: number): boolean => {
    const d = Math.abs(((f - foldPhase) % period) + period) % period
    return Math.min(d, period - d) <= search
  }
  let firstOnset = -1
  for (let f = 1; f < frames - 1; f++)
    if (
      flux[f] >= onsetFloor &&
      flux[f] >= flux[f - 1] &&
      flux[f] >= flux[f + 1] &&
      onPhase(f)
    ) {
      firstOnset = f
      break
    }
  let at = firstOnset >= 0 ? firstOnset : anchorSec * fps
  while (at - period >= 0) at -= period
  let coasted = 0
  while (at < frames) {
    // The first beat heard after a long hole is a SEAM: across a breakdown the
    // tracker measured nothing, so whatever the record did in there — kept
    // time, or slid — is unknown, and the fit downstream must be free to start
    // a new segment rather than draw one line across bars it never saw.
    //
    // The search stays at a quarter period even here. Widening it to hunt a
    // drifted beat sounds right and is a trap: half a period reaches the
    // NEIGHBOURING beat, so a re-seek can land on the off-beat and re-phase the
    // whole grid half a bar off — which on a steady record with a breakdown
    // (the common case) turns a perfect one-segment grid into a broken two.
    const seam = coasted >= RESEEK_AFTER_BEATS
    const found = peakNear(at)
    if (found === null) {
      // Silence or a wash: coast at the current tempo rather than let noise
      // pull the grid. The beat still counts — it just leaves no evidence.
      at += period
      index++
      coasted++
      continue
    }
    beats.push({ atSec: found / fps, index, seam })
    // The observed interval refines the period — divided by how many beats it
    // actually spanned, so a hit landing after a coasted hole still reports a
    // per-beat interval rather than the whole gap. An interval measured ACROSS
    // a hole is not evidence of tempo (the hole hid whatever happened in it),
    // so a seam never adapts the period.
    if (lastFound && !seam) {
      const spanned = index - lastFound.index
      const observed = (found - lastFound.atFrame) / spanned
      // A hit landing at a plausible beat distance refines the tempo; anything
      // wilder is a missed beat or a stray transient and must not.
      if (spanned > 0 && observed > 0.75 * period && observed < 1.25 * period)
        period += ADAPT * (observed - period)
    }
    lastFound = { atFrame: found, index }
    at = found + period
    index++
    coasted = 0
  }
  return beats
}

// Splits tracked beats into the fewest constant-tempo stretches that keep every
// beat on the grid, and states each as a segment (its own tempo, its own phase).
//
// Greedy and forward-only: extend the current stretch while a straight line
// through its beats still predicts them all inside the tolerance; the moment a
// beat falls outside, that beat starts a new stretch. On a steady record the
// first line holds to the last beat and there is exactly one segment. A splice
// breaks the line at the seam; a dragging platter breaks it wherever the ramp
// has bent far enough to matter, so a slow drift becomes a handful of segments
// rather than the churn of one re-anchor per window.
function fitSegments(beats: TrackedBeat[], tolSec: number): { bpm: number; anchorSec: number }[] {
  const segments: { bpm: number; anchorSec: number }[] = []
  let start = 0
  while (start < beats.length) {
    // Fit beat TIME against beat INDEX: the slope is the beat period (so the
    // tempo) and the intercept is the phase. Both fall out of the same line.
    let end = start + 1
    let best = fitLine(beats, start, Math.min(start + 2, beats.length))
    while (end < beats.length) {
      // A seam may end the stretch, but only if the beat after the hole has
      // actually moved: a record that kept time across its breakdown still fits
      // the same line, and cutting a segment there would state a tempo change
      // that never happened — churn in every export. So the seam is tested, not
      // obeyed: does this beat still land where the line before the hole says?
      if (beats[end].seam) {
        const gap = Math.abs(best.slope * beats[end].index + best.intercept - beats[end].atSec)
        if (gap > tolSec) break
      }
      const candidate = fitLine(beats, start, end + 1)
      let worst = 0
      for (let i = start; i <= end; i++)
        worst = Math.max(
          worst,
          Math.abs(candidate.slope * beats[i].index + candidate.intercept - beats[i].atSec),
        )
      if (worst > tolSec) break
      best = candidate
      end++
    }
    // A stretch too short to hold a tempo would state one anyway, out of a
    // couple of beats that fit any line. Skip it — its beats stay under the
    // previous segment's grid — and keep scanning: abandoning the scan here
    // would throw away every segment in the REST of the track, which on a
    // record with a breakdown is most of it.
    const tooShort = end - start < MIN_SEGMENT_BEATS && segments.length > 0
    if (!tooShort && best.slope > 0)
      segments.push({
        bpm: 60 / best.slope,
        anchorSec: best.intercept + best.slope * beats[start].index,
      })
    start = end
  }
  return segments
}

// Least squares of beat time against beat INDEX over [from, to): slope =
// seconds per beat, intercept = the time beat 0 of that line would fall at.
function fitLine(
  beats: TrackedBeat[],
  from: number,
  to: number,
): { slope: number; intercept: number } {
  const n = to - from
  if (n < 2) return { slope: 0, intercept: beats[from].atSec }
  let sumX = 0
  let sumY = 0
  for (let i = from; i < to; i++) {
    sumX += beats[i].index
    sumY += beats[i].atSec
  }
  const meanX = sumX / n
  const meanY = sumY / n
  let sxy = 0
  let sxx = 0
  for (let i = from; i < to; i++) {
    sxy += (beats[i].index - meanX) * (beats[i].atSec - meanY)
    sxx += (beats[i].index - meanX) ** 2
  }
  const slope = sxx === 0 ? 0 : sxy / sxx
  return { slope, intercept: meanY - slope * meanX }
}

// The vinyl-rip drift that multi-segment grids exist for (a splice, a needle
// bump, a platter that drags). Tracks the beat across the file, then states the
// result as segments — each with the tempo its own stretch runs at, which is
// what keeps the grid on the kicks. A phase-only re-anchor (what this used to
// do) leaves the wrong tempo running underneath and the grid walks off again
// within bars.
function detectDrift(
  flux: Float32Array,
  fps: number,
  bpm: number,
  anchorSec: number,
): { anchorSec: number; bpm: number; changes: GridChange[] } {
  const frames = flux.length
  const winFrames = Math.round(DRIFT_WINDOW_SEC * fps)
  if (winFrames <= 0 || frames < winFrames * 2) return { anchorSec, bpm, changes: [] }

  const beats = trackBeats(flux, fps, bpm, anchorSec)
  if (beats.length < MIN_SEGMENT_BEATS * 2) return { anchorSec, bpm, changes: [] }

  const segments = fitSegments(beats, SEGMENT_FIT_TOL_SEC)
  if (segments.length === 0) return { anchorSec, bpm, changes: [] }

  const head = segments[0]
  // The tracker only overrules the global detection past these gates, so a
  // steady record keeps exactly the tempo and anchor that the whole-file
  // autocorrelation and phase fold reported, and neither a tempo nor a segment
  // ever appears out of measurement noise.
  const baseBpm = Math.abs(head.bpm - bpm) / bpm > TEMPO_FIT_MIN_SLOPE ? head.bpm : bpm
  // The base grid is phased on the base segment's own line read at the FIRST
  // BEAT THE TRACKER HEARD, not at beat 0 of that line. The two differ whenever
  // the base segment does not start at the head of the file — the fit's
  // intercept is then an extrapolation backwards across everything the segment
  // does not cover, and on a record whose speed is sliding that extrapolation
  // walks the anchor off the very kicks it is meant to sit on (measured: 61 ms,
  // on a dragging platter whose first segment began 20 s in).
  const headPhase = snapAnchor(head.anchorSec, baseBpm)
  const basePhase = snapAnchor(anchorSec, baseBpm)
  const period = 60 / baseBpm
  // Phase is circular, so the anchors are compared the short way round: a
  // tracked first beat one period along from the folded one is the SAME phase,
  // and rebasing on that difference would move a line the user is watching.
  const gap = Math.abs(headPhase - basePhase)
  const baseAnchor = Math.min(gap, period - gap) > DRIFT_REBASE_SEC ? headPhase : anchorSec

  const changes: GridChange[] = []
  for (let s = 1; s < segments.length; s++) {
    const seg = segments[s]
    changes.push({
      anchorSec: Number(seg.anchorSec.toFixed(3)),
      bpm: Number(seg.bpm.toFixed(3)),
    })
  }
  return { anchorSec: baseAnchor, bpm: baseBpm, changes }
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

  // The drift scan fits each stretch of the track to its own tempo and phase:
  // it may re-base the anchor onto the opening windows, correct the base tempo
  // the whole-file autocorrelation averaged, and add a change per confirmed
  // mid-track seam — the automatic counterpart of "Adjust from here", but
  // fitted rather than merely re-anchored. Its anchor gets the same wrap-to-zero
  // read as above.
  const drift = detectDrift(flux, fps, result.bpm, anchorSec)
  const baseAnchor = periodSec - drift.anchorSec < (1.5 * HOP) / sampleRate ? 0 : drift.anchorSec
  return {
    bpm: drift.bpm,
    confidence: result.confidence,
    anchorSec: baseAnchor,
    phaseAmbiguity,
    phaseMargin,
    ...(drift.changes.length > 0 ? { changes: drift.changes } : {}),
  }
}
