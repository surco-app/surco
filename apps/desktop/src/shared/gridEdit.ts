export interface GridZone {
  fromMs: number
  bpm: number
  anchorMs: number
}

export interface EditableGrid {
  bpm: number
  anchorMs: number
  zones?: GridZone[]
}

export interface GridFit {
  bpm: number
  firstMs: number
  phases?: { ms: number; firstMs: number }[]
}

export const GRID_BPM_MIN = 40
export const GRID_BPM_MAX = 300

const CONSTANT_TOLERANCE_MS = 2
const ZONE_BREAK_MS = 3
const MAX_ZONES = 8
const MIN_ZONE_BEATS = 4
const SAME_TEMPO_RATIO = 0.01

const periodOf = (bpm: number): number => 60000 / bpm
const barBeat = (k: number): number => (((k % 4) + 4) % 4) + 1

function fitRun(beats: { ms: number; beat: number }[]): EditableGrid | null {
  const n = beats.length
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

function runsOf(beats: { ms: number; beat: number }[]): [number, number][] {
  const runs: [number, number][] = []
  let start = 0
  for (let i = 1; i < beats.length; i++) {
    const follows = beats[i].beat === (beats[i - 1].beat % 4) + 1
    const gap = beats[i].ms - beats[i - 1].ms
    const usual = i - start < 2 ? gap : (beats[i - 1].ms - beats[start].ms) / (i - 1 - start)
    if (follows && Math.abs(gap - usual) <= ZONE_BREAK_MS) continue
    runs.push([start, i])
    start = i
  }
  runs.push([start, beats.length])
  return runs
}

export function editableGridOf(beats: { ms: number; beat: number }[]): EditableGrid | null {
  if (beats.length < 2) return null
  const runs = runsOf(beats)
  if (runs.length > MAX_ZONES) return null
  if (runs.length > 1 && runs.some(([a, b]) => b - a < MIN_ZONE_BEATS)) return null
  const fits = runs.map(([a, b]) => fitRun(beats.slice(a, b)))
  if (fits.some((f) => f === null)) return null
  const [base, ...rest] = fits as EditableGrid[]
  if (rest.length === 0) return base
  return {
    ...base,
    zones: rest.map((z, i) => ({
      fromMs: beats[runs[i + 1][0]].ms,
      bpm: z.bpm,
      anchorMs: z.anchorMs,
    })),
  }
}

function zonesOf(grid: EditableGrid): GridZone[] {
  return [
    { fromMs: Number.NEGATIVE_INFINITY, bpm: grid.bpm, anchorMs: grid.anchorMs },
    ...(grid.zones ?? []),
  ]
}

function boundaryOf(zone: GridZone): number {
  return zone.fromMs - periodOf(zone.bpm) / 2
}

function zoneIndexAt(grid: EditableGrid, ms: number): number {
  const zones = zonesOf(grid)
  let index = 0
  zones.forEach((z, i) => {
    if (i > 0 && boundaryOf(z) <= ms) index = i
  })
  return index
}

export function zoneAt(grid: EditableGrid, ms: number): EditableGrid {
  const zone = zonesOf(grid)[zoneIndexAt(grid, ms)]
  return { bpm: zone.bpm, anchorMs: zone.anchorMs }
}

export function anchorNear(grid: EditableGrid, ms: number): boolean {
  return (grid.zones ?? []).some((z) => Math.abs(z.fromMs - ms) < periodOf(z.bpm) / 2)
}

export function gridAnchors(grid: EditableGrid): number[] {
  return (grid.zones ?? []).map((z) => z.fromMs)
}

export function editAt(
  grid: EditableGrid,
  ms: number,
  edit: (zone: EditableGrid) => EditableGrid | null,
): EditableGrid | null {
  const index = zoneIndexAt(grid, ms)
  const zones = zonesOf(grid)
  const next = edit({ bpm: zones[index].bpm, anchorMs: zones[index].anchorMs })
  if (!next) return null
  if (index === 0) return { ...grid, bpm: next.bpm, anchorMs: next.anchorMs }
  return {
    ...grid,
    zones: (grid.zones ?? []).map((z, i) =>
      i === index - 1 ? { ...z, bpm: next.bpm, anchorMs: next.anchorMs } : z,
    ),
  }
}

export function toggleAnchor(grid: EditableGrid, ms: number): EditableGrid {
  const zones = grid.zones ?? []
  const existing = zones.findIndex((z) => Math.abs(z.fromMs - ms) < periodOf(z.bpm) / 2)
  if (existing >= 0) {
    const left = zones.filter((_, i) => i !== existing)
    const { zones: _, ...base } = grid
    return left.length > 0 ? { ...base, zones: left } : base
  }
  const zone = zonesOf(grid)[zoneIndexAt(grid, ms)]
  const fromMs = nearestOn(ms, zone.anchorMs, periodOf(zone.bpm))
  const added = { fromMs, bpm: zone.bpm, anchorMs: zone.anchorMs }
  return { ...grid, zones: [...zones, added].sort((a, b) => a.fromMs - b.fromMs) }
}

export function gridBeats(grid: EditableGrid, durationMs: number): { ms: number; beat: number }[] {
  const zones = zonesOf(grid)
  const out: { ms: number; beat: number }[] = []
  zones.forEach((zone, i) => {
    const period = periodOf(zone.bpm)
    const from = i === 0 ? 0 : boundaryOf(zone)
    const to = i + 1 < zones.length ? boundaryOf(zones[i + 1]) : durationMs
    for (let k = Math.ceil((from - zone.anchorMs) / period); zone.anchorMs + k * period < to; k++)
      out.push({ ms: zone.anchorMs + k * period, beat: barBeat(k) })
  })
  return out
}

export function gridTempos(grid: EditableGrid, durationMs: number): number[] {
  return gridBeats(grid, durationMs).map((b) => zonesOf(grid)[zoneIndexAt(grid, b.ms)].bpm)
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

const near = (a: number, b: number): boolean => Math.abs(a - b) < SAME_EPSILON

export function sameGrid(a: EditableGrid | null, b: EditableGrid | null): boolean {
  if (a === null || b === null) return a === b
  const za = zonesOf(a)
  const zb = zonesOf(b)
  return (
    za.length === zb.length &&
    za.every(
      (z, i) =>
        (i === 0 || near(z.fromMs, zb[i].fromMs)) &&
        near(z.bpm, zb[i].bpm) &&
        near(z.anchorMs, zb[i].anchorMs),
    )
  )
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
  const first = atMs === undefined ? fit.firstMs : phaseNear(fit, atMs)
  const fitted = editAt(grid, atMs ?? 0, (zone) => {
    const sameTempo = Math.abs(fit.bpm - zone.bpm) / zone.bpm < SAME_TEMPO_RATIO
    return {
      bpm: sameTempo ? fit.bpm : zone.bpm,
      anchorMs: nearestOn(zone.anchorMs, first, periodOf(fit.bpm)),
    }
  })
  return fitted ?? grid
}

export function gridOffsets(
  grid: EditableGrid,
  fit: GridFit,
  playheadMs: number,
  durationMs: number,
): { hereMs: number; endMs: number } {
  const offsetAt = (ms: number): number => {
    const zone = zonesOf(grid)[zoneIndexAt(grid, ms)]
    const beat = nearestOn(ms, zone.anchorMs, periodOf(zone.bpm))
    return Math.round(beat - nearestOn(beat, phaseNear(fit, ms), periodOf(fit.bpm)))
  }
  return { hereMs: offsetAt(playheadMs), endMs: offsetAt(durationMs) }
}

export function gridFingerprint(grid: { ms: number; beat: number }[]): string {
  return grid.map((b) => `${b.ms}|${b.beat}`).join(';')
}
