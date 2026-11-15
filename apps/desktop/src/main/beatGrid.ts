import type { GridAudit } from '../shared/gridAudit'
import { START_SLACK_MS } from '../shared/gridEdit'
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
const LEVEL_FLOOR = 1e-6
const EARLIER_RISE_RATIO = 0.9

function hitStart(rises: number[], steepest: number): number {
  const bins = rises.length
  for (let back = Math.round(bins / 4); back >= 1; back--) {
    const b = (steepest - back + bins) % bins
    const rise = rises[b]
    if (
      rise >= EARLIER_RISE_RATIO * rises[steepest] &&
      rise >= rises[(b + 1) % bins] &&
      rise >= rises[(b - 1 + bins) % bins]
    )
      return b
  }
  return steepest
}

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
    return Math.log(sum[at] / (count[at] || 1) + LEVEL_FLOOR)
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
  const best = hitStart(rises, rises.indexOf(Math.max(...rises)))
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
    return Math.log(sum[at] / (count[at] || 1) + LEVEL_FLOOR)
  }
  const rises = Array.from(
    { length: BINS },
    (_, b) => mean(b + 1) + mean(b + 2) - mean(b - 1) - mean(b - 2),
  )
  return (hitStart(rises, rises.indexOf(Math.max(...rises))) + 0.5) / BINS
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

export type GridAuditRun = Pick<GridAudit, 'windows' | 'total'> & {
  minutes: number
  fit: BeatGridFit | null
}

const AUDIT_WINDOW_BEATS = 16
const AUDIT_STEP_BEATS = 8

export function auditGrid(
  pcm: Float32Array,
  sampleRate: number,
  beatsMs: number[],
  leadMs: number,
): Pick<GridAudit, 'windows' | 'total'> {
  const levels = energy(pcm, FINE_HOP)
  const msPerFrame = (FINE_HOP / sampleRate) * 1000
  let total = 0
  for (const l of levels) total += l
  const loud = (total / Math.max(1, levels.length)) * SILENT_WINDOW_RATIO
  const reach = (2 * FINE_BINS) / BINS
  const windows: GridAudit['windows'] = []
  let count = 0
  for (let i = 0; i + AUDIT_WINDOW_BEATS < beatsMs.length; i += AUDIT_STEP_BEATS) {
    count++
    const sum = new Float64Array(FINE_BINS)
    const hits = new Float64Array(FINE_BINS)
    let level = 0
    let frames = 0
    for (let k = i; k < i + AUDIT_WINDOW_BEATS; k++) {
      const beat = beatsMs[k]
      const period = beatsMs[k + 1] - beat
      const from = Math.max(0, Math.floor((beat - period / 2 - leadMs) / msPerFrame))
      const to = Math.min(levels.length, Math.floor((beat + period / 2 - leadMs) / msPerFrame))
      for (let f = from; f < to; f++) {
        const bin = Math.floor(((f * msPerFrame + leadMs - beat) / period + 0.5) * FINE_BINS)
        if (bin < 0 || bin >= FINE_BINS) continue
        sum[bin] += levels[f]
        hits[bin]++
        level += levels[f]
        frames++
      }
    }
    if (frames === 0 || level / frames < loud) continue
    const mean = (bin: number): number => {
      const at = ((bin % FINE_BINS) + FINE_BINS) % FINE_BINS
      return Math.log(sum[at] / (hits[at] || 1) + LEVEL_FLOOR)
    }
    const rises = Array.from({ length: FINE_BINS }, (_, b) => {
      let rise = 0
      for (let k = 1; k <= reach; k++) rise += mean(b + k) - mean(b - k)
      return rise
    })
    const steepest = rises.indexOf(Math.max(...rises))
    const best = hitStart(rises, steepest)
    const apart = (a: number, b: number) => {
      const d = Math.abs(a - b) % FINE_BINS
      return Math.min(d, FINE_BINS - d) > FINE_BINS / 16
    }
    const second = Math.max(
      0,
      ...rises.filter((_, b) =>
        [best, best + FINE_BINS / 2, steepest, steepest + FINE_BINS / 2].every((at) =>
          apart(b, at),
        ),
      ),
    )
    if (second > 0 && rises[steepest] / second < FINE_SURE_RATIO) continue
    const period = (beatsMs[i + AUDIT_WINDOW_BEATS] - beatsMs[i]) / AUDIT_WINDOW_BEATS
    const phase = (best + 0.5) / FINE_BINS - 0.5
    const folded = Math.abs(phase) > 0.25 ? phase - Math.sign(phase) * 0.5 : phase
    windows.push({
      ms: beatsMs[i + AUDIT_WINDOW_BEATS / 2],
      offsetMs: folded * period + REKORDBOX_BEAT_AFTER_RISE_MS,
    })
  }
  return { windows, total: count }
}

export function provisionalGrid(
  fit: BeatGridFit,
  shiftMs: number,
  durationMs: number,
): { ms: number; beat: number }[] {
  const period = 60000 / fit.bpm
  const offset = fit.firstMs + shiftMs + REKORDBOX_BEAT_AFTER_RISE_MS
  const first = offset - Math.floor((offset + START_SLACK_MS) / period) * period
  const grid: { ms: number; beat: number }[] = []
  for (let ms = first; ms < durationMs; ms += period)
    grid.push({ ms: Math.max(0, Math.round(ms)), beat: 0 })
  return grid
}
