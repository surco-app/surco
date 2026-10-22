import { detectBpm } from './tempo'

const HOP = 32
const BINS = 96
const COARSE_SECONDS = 240
const REKORDBOX_BEAT_AFTER_RISE_MS = 2

export interface BeatGridFit {
  bpm: number
  firstMs: number
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

function steepestRise(levels: Float32Array, periodFrames: number): number {
  const sum = new Float64Array(BINS)
  const count = new Float64Array(BINS)
  for (let f = 0; f < levels.length; f++) {
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
  return { bpm, firstMs: steepestRise(energy(pcm), periodFrames) * (60000 / bpm) }
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
