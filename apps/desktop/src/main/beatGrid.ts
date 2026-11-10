import { detectBpm } from './tempo'

const HOP = 32
const BINS = 96
const COARSE_SECONDS = 240
export const REKORDBOX_BEAT_AFTER_RISE_MS = 2

const PHASE_WINDOW_BEATS = 32
const PHASE_STEP_BEATS = 16
const SILENT_WINDOW_RATIO = 0.1
const FINE_HOP = 16
const FINE_BINS = 192
const FINE_WINDOW_BEATS = 8
const FINE_STEP_BEATS = 4
const FINE_SURE_RATIO = 2

export interface BeatGridFit {
  bpm: number
  firstMs: number
  phases?: { ms: number; firstMs: number }[]
  fine?: { ms: number; firstMs: number }[]
}

function energy(pcm: Float32Array, hop = HOP): Float32Array {
  const frames = Math.floor(pcm.length / hop)
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) sum += pcm[i] * pcm[i]
    out[f] = Math.sqrt(sum / hop)
  }
  return out
}

function foldedMeans(
  levels: Float32Array,
  periodFrames: number,
  bins: number,
  from: number,
  to: number,
): (bin: number) => number {
  const sum = new Float64Array(bins)
  const count = new Float64Array(bins)
  for (let f = from; f < to; f++) {
    const p = f / periodFrames
    const bin = Math.floor((p - Math.floor(p)) * bins)
    sum[bin] += levels[f]
    count[bin]++
  }
  return (bin) => {
    const at = ((bin % bins) + bins) % bins
    return sum[at] / (count[at] || 1)
  }
}

function surestRise(
  levels: Float32Array,
  periodFrames: number,
  from: number,
  to: number,
): { phase: number; sure: number } {
  const mean = foldedMeans(levels, periodFrames, FINE_BINS, from, to)
  const reach = (2 * FINE_BINS) / BINS
  const rises = Array.from({ length: FINE_BINS }, (_, b) => {
    let rise = 0
    for (let k = 1; k <= reach; k++) rise += mean(b + k) - mean(b - k)
    return rise
  })
  const best = rises.indexOf(Math.max(...rises))
  const apart = (a: number, b: number) => {
    const d = Math.abs(a - b) % FINE_BINS
    return Math.min(d, FINE_BINS - d) > FINE_BINS / 16
  }
  const second = Math.max(
    0,
    ...rises.filter((_, b) => apart(b, best) && apart(b, best + FINE_BINS / 2)),
  )
  return {
    phase: (best + 0.5) / FINE_BINS,
    sure: second > 0 ? rises[best] / second : Number.POSITIVE_INFINITY,
  }
}

function steepestRise(
  levels: Float32Array,
  periodFrames: number,
  from = 0,
  to = levels.length,
): number {
  const sum = new Float64Array(BINS)
  const count = new Float64Array(BINS)
  for (let f = from; f < to; f++) {
    const p = f / periodFrames
    const bin = Math.floor((p - Math.floor(p)) * BINS)
    sum[bin] += levels[f]
    count[bin]++
  }
  const mean = (bin: number): number => {
    const at = (bin + BINS) % BINS
    return sum[at] / (count[at] || 1)
  }
  let best = -Infinity
  let bestBin = 0
  for (let b = 0; b < BINS; b++) {
    const rise = mean(b + 1) + mean(b + 2) - mean(b - 1) - mean(b - 2)
    if (rise > best) {
      best = rise
      bestBin = b
    }
  }
  return (bestBin + 0.5) / BINS
}

export function fitBeatGrid(pcm: Float32Array, sampleRate: number): BeatGridFit | null {
  const coarse = detectBpm(pcm.subarray(0, sampleRate * COARSE_SECONDS), sampleRate)
  if (!coarse) return null
  const { bpm } = coarse
  const periodFrames = (60 * sampleRate) / HOP / bpm
  const levels = energy(pcm)
  const periodMs = 60000 / bpm
  return {
    bpm,
    firstMs: steepestRise(levels, periodFrames) * periodMs,
    phases: phasesOf(levels, periodFrames, periodMs, sampleRate),
    fine: finePhasesOf(pcm, bpm, sampleRate),
  }
}

function finePhasesOf(
  pcm: Float32Array,
  bpm: number,
  sampleRate: number,
): { ms: number; firstMs: number }[] {
  const levels = energy(pcm, FINE_HOP)
  const periodFrames = (60 * sampleRate) / FINE_HOP / bpm
  const periodMs = 60000 / bpm
  const msPerFrame = (FINE_HOP / sampleRate) * 1000
  let total = 0
  for (const l of levels) total += l
  const loud = (total / Math.max(1, levels.length)) * SILENT_WINDOW_RATIO
  const window = Math.round(FINE_WINDOW_BEATS * periodFrames)
  const step = Math.round(FINE_STEP_BEATS * periodFrames)
  const out: { ms: number; firstMs: number }[] = []
  for (let from = 0; from + window <= levels.length; from += step) {
    let sum = 0
    for (let f = from; f < from + window; f++) sum += levels[f]
    if (sum / window < loud) continue
    const { phase, sure } = surestRise(levels, periodFrames, from, from + window)
    if (sure < FINE_SURE_RATIO) continue
    out.push({ ms: (from + window / 2) * msPerFrame, firstMs: phase * periodMs })
  }
  return out
}

function phasesOf(
  levels: Float32Array,
  periodFrames: number,
  periodMs: number,
  sampleRate: number,
): { ms: number; firstMs: number }[] {
  const meanOf = (from: number, to: number): number => {
    let sum = 0
    for (let f = from; f < to; f++) sum += levels[f]
    return sum / Math.max(1, to - from)
  }
  const loud = meanOf(0, levels.length) * SILENT_WINDOW_RATIO
  const window = Math.round(PHASE_WINDOW_BEATS * periodFrames)
  const step = Math.round(PHASE_STEP_BEATS * periodFrames)
  const msPerFrame = (HOP / sampleRate) * 1000
  const out: { ms: number; firstMs: number }[] = []
  for (let from = 0; from + window <= levels.length; from += step) {
    if (meanOf(from, from + window) < loud) continue
    out.push({
      ms: (from + window / 2) * msPerFrame,
      firstMs: steepestRise(levels, periodFrames, from, from + window) * periodMs,
    })
  }
  return out
}

export function provisionalGrid(
  fit: BeatGridFit,
  shiftMs: number,
  durationMs: number,
): { ms: number; beat: number }[] {
  const period = 60000 / fit.bpm
  const offset = fit.firstMs + shiftMs + REKORDBOX_BEAT_AFTER_RISE_MS
  const first = offset - Math.floor(offset / period) * period
  const grid: { ms: number; beat: number }[] = []
  for (let ms = first; ms < durationMs; ms += period) grid.push({ ms: Math.round(ms), beat: 0 })
  return grid
}
