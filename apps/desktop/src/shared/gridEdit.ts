export interface EditableGrid {
  bpm: number
  anchorMs: number
}

export interface GridFit {
  bpm: number
  firstMs: number
  phases?: { ms: number; firstMs: number }[]
}

export const GRID_BPM_MIN = 40
export const GRID_BPM_MAX = 300

const CONSTANT_TOLERANCE_MS = 2
const SAME_TEMPO_RATIO = 0.01

const periodOf = (bpm: number): number => 60000 / bpm
const barBeat = (k: number): number => (((k % 4) + 4) % 4) + 1

export function editableGridOf(beats: { ms: number; beat: number }[]): EditableGrid | null {
  const n = beats.length
  if (n < 2) return null
  const meanI = (n - 1) / 2
  const meanMs = beats.reduce((sum, b) => sum + b.ms, 0) / n
  let num = 0
  let den = 0
  beats.forEach((b, i) => {
    num += (i - meanI) * (b.ms - meanMs)
    den += (i - meanI) ** 2
  })
  const period = num / den
  const start = meanMs - period * meanI
  if (beats.some((b, i) => Math.abs(b.ms - (start + period * i)) > CONSTANT_TOLERANCE_MS))
    return null
  const downbeat = beats.find((b) => b.beat === 1)
  const anchorMs = downbeat ? downbeat.ms : beats[0].ms + ((5 - beats[0].beat) % 4) * period
  if (beats.some((b) => b.beat !== barBeat(Math.round((b.ms - anchorMs) / period)))) return null
  return { bpm: periodOf(period), anchorMs }
}

export function gridBeats(grid: EditableGrid, durationMs: number): { ms: number; beat: number }[] {
  const period = periodOf(grid.bpm)
  const out: { ms: number; beat: number }[] = []
  for (let k = Math.ceil(-grid.anchorMs / period); grid.anchorMs + k * period < durationMs; k++)
    out.push({ ms: grid.anchorMs + k * period, beat: barBeat(k) })
  return out
}

export function shiftGrid(grid: EditableGrid, deltaMs: number): EditableGrid {
  return { ...grid, anchorMs: grid.anchorMs + deltaMs }
}

export function retempoGrid(grid: EditableGrid, bpm: number, pivotMs: number): EditableGrid | null {
  if (bpm < GRID_BPM_MIN || bpm > GRID_BPM_MAX) return null
  const old = periodOf(grid.bpm)
  const k = Math.round((pivotMs - grid.anchorMs) / old)
  return { bpm, anchorMs: grid.anchorMs + k * old - k * periodOf(bpm) }
}

export function scaleGrid(grid: EditableGrid, factor: 2 | 0.5): EditableGrid | null {
  const bpm = grid.bpm * factor
  return bpm < GRID_BPM_MIN || bpm > GRID_BPM_MAX ? null : { bpm, anchorMs: grid.anchorMs }
}

const SAME_EPSILON = 1e-6

export function sameGrid(a: EditableGrid | null, b: EditableGrid | null): boolean {
  if (a === null || b === null) return a === b
  return Math.abs(a.bpm - b.bpm) < SAME_EPSILON && Math.abs(a.anchorMs - b.anchorMs) < SAME_EPSILON
}

export function downbeatAt(grid: EditableGrid, ms: number): EditableGrid {
  return { ...grid, anchorMs: ms }
}

const nearestOn = (ms: number, firstMs: number, period: number): number =>
  firstMs + Math.round((ms - firstMs) / period) * period

function phaseNear(fit: GridFit, ms: number): number {
  if (!fit.phases || fit.phases.length === 0) return fit.firstMs
  const local = fit.phases.reduce((a, b) => (Math.abs(b.ms - ms) < Math.abs(a.ms - ms) ? b : a))
  const period = periodOf(fit.bpm)
  const apart = Math.abs(local.firstMs - nearestOn(local.firstMs, fit.firstMs, period))
  return apart > period / 4 ? fit.firstMs : local.firstMs
}

export function fitGrid(grid: EditableGrid, fit: GridFit, atMs?: number): EditableGrid {
  const sameTempo = Math.abs(fit.bpm - grid.bpm) / grid.bpm < SAME_TEMPO_RATIO
  const first = atMs === undefined ? fit.firstMs : phaseNear(fit, atMs)
  return {
    bpm: sameTempo ? fit.bpm : grid.bpm,
    anchorMs: nearestOn(grid.anchorMs, first, periodOf(fit.bpm)),
  }
}

export function gridOffsets(
  grid: EditableGrid,
  fit: GridFit,
  playheadMs: number,
  durationMs: number,
): { hereMs: number; endMs: number } {
  const offsetAt = (ms: number): number => {
    const beat = nearestOn(ms, grid.anchorMs, periodOf(grid.bpm))
    return Math.round(beat - nearestOn(beat, phaseNear(fit, ms), periodOf(fit.bpm)))
  }
  return { hereMs: offsetAt(playheadMs), endMs: offsetAt(durationMs) }
}

export function gridFingerprint(grid: { ms: number; beat: number }[]): string {
  return grid.map((b) => `${b.ms}|${b.beat}`).join(';')
}
