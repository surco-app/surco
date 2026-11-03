export interface EditableGrid {
  bpm: number
  anchorMs: number
}

export interface GridFit {
  bpm: number
  firstMs: number
}

export const GRID_BPM_MIN = 40
export const GRID_BPM_MAX = 300

const CONSTANT_TOLERANCE_MS = 2
const SAME_TEMPO_RATIO = 0.01

const periodOf = (bpm: number): number => 60000 / bpm
const hundredths = (n: number): number => Math.round(n * 100) / 100
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
  return { bpm: hundredths(periodOf(period)), anchorMs }
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

export function downbeatAt(grid: EditableGrid, ms: number): EditableGrid {
  return { ...grid, anchorMs: ms }
}

const nearestOn = (ms: number, firstMs: number, period: number): number =>
  firstMs + Math.round((ms - firstMs) / period) * period

export function fitGrid(grid: EditableGrid, fit: GridFit): EditableGrid {
  const sameTempo = Math.abs(fit.bpm - grid.bpm) / grid.bpm < SAME_TEMPO_RATIO
  return {
    bpm: sameTempo ? fit.bpm : grid.bpm,
    anchorMs: nearestOn(grid.anchorMs, fit.firstMs, periodOf(fit.bpm)),
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
    return Math.round(beat - nearestOn(beat, fit.firstMs, periodOf(fit.bpm)))
  }
  return { hereMs: offsetAt(playheadMs), endMs: offsetAt(durationMs) }
}
