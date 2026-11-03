import { detectBpm } from './tempo'

const HOP = 32
const BINS = 96
const COARSE_SECONDS = 240
export const REKORDBOX_BEAT_AFTER_RISE_MS = 2

const PHASE_WINDOW_BEATS = 32
const PHASE_STEP_BEATS = 16
const SILENT_WINDOW_RATIO = 0.1

export interface BeatGridFit {
  bpm: number
  firstMs: number
  phases?: { ms: number; firstMs: number }[]
}

function energy(pcm: Float32Array): Float32Array {
  const frames = Math.floor(pcm.length / HOP)
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    for (let i = f * HOP; i < (f + 1) * HOP; i++) sum += pcm[i] * pcm[i]
    out[f] = Math.sqrt(sum / HOP)
  }
  return out
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
  }
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
