import { nearestBeatMs } from './cueGrid'

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
  fine?: { ms: number; firstMs: number }[]
}

export const SAME_CLOCK_FILE = /\.(wav|aif|aiff|flac)$/i

export const GRID_BPM_MIN = 40
export const GRID_BPM_MAX = 300

const CONSTANT_TOLERANCE_MS = 2
const ZONE_BREAK_MS = 3
const MIN_ZONE_BEATS = 4
const SAME_TEMPO_RATIO = 0.01
const START_SLACK_MS = 0.5

const periodOf = (bpm: number): number => 60000 / bpm
const barBeat = (k: number): number => (((k % 4) + 4) % 4) + 1

type StoredBeat = { ms: number; beat: number; bpm?: number }

function fitRun(beats: StoredBeat[], tolerance: number): EditableGrid | null {
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
  if (beats.some((b, i) => Math.abs(b.ms - (start + period * i)) > tolerance)) return null
  const downbeat = beats.find((b) => b.beat === 1)
  const anchorMs = downbeat ? downbeat.ms : beats[0].ms + ((5 - beats[0].beat) % 4) * period
  if (beats.some((b) => b.beat !== barBeat(Math.round((b.ms - anchorMs) / period)))) return null
  return { bpm: periodOf(period), anchorMs }
}

function runsOf(beats: StoredBeat[], byTempo: boolean): [number, number][] {
  const runs: [number, number][] = []
  let start = 0
  for (let i = 1; i < beats.length; i++) {
    const follows =
      beats[i].beat === (beats[i - 1].beat % 4) + 1 &&
      (!byTempo || beats[i].bpm === beats[i - 1].bpm)
    const gap = beats[i].ms - beats[i - 1].ms
    const usual = i - start < 2 ? gap : (beats[i - 1].ms - beats[start].ms) / (i - 1 - start)
    if (follows && Math.abs(gap - usual) <= ZONE_BREAK_MS) continue
    runs.push([start, i])
    start = i
  }
  runs.push([start, beats.length])
  return runs
}

const longEnough = (runs: [number, number][]): boolean =>
  runs.every(([a, b]) => b - a >= MIN_ZONE_BEATS)

function lineCost(ms: number[], from: number, to: number): number {
  const n = to - from
  const meanI = (n - 1) / 2
  let meanMs = 0
  for (let i = from; i < to; i++) meanMs += ms[i] / n
  let num = 0
  let den = 0
  for (let i = from; i < to; i++) {
    num += (i - from - meanI) * (ms[i] - meanMs)
    den += (i - from - meanI) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  let cost = 0
  for (let i = from; i < to; i++) cost += (ms[i] - meanMs - slope * (i - from - meanI)) ** 2
  return cost
}

function fittedPieces(
  beats: StoredBeat[],
  tolerance: number,
): { from: number; grid: EditableGrid }[] | null {
  const whole = fitRun(beats, tolerance)
  if (whole) return [{ from: 0, grid: whole }]
  if (beats.length < 2 * MIN_ZONE_BEATS) return null
  const ms = beats.map((b) => b.ms)
  let best = MIN_ZONE_BEATS
  let bestCost = Number.POSITIVE_INFINITY
  for (let at = MIN_ZONE_BEATS; at <= beats.length - MIN_ZONE_BEATS; at++) {
    const cost = lineCost(ms, 0, at) + lineCost(ms, at, beats.length)
    if (cost < bestCost) {
      bestCost = cost
      best = at
    }
  }
  const left = fittedPieces(beats.slice(0, best), tolerance)
  const right = fittedPieces(beats.slice(best), tolerance)
  if (!left || !right) return null
  return [...left, ...right.map((piece) => ({ ...piece, from: piece.from + best }))]
}

export function editableGridOf(beats: StoredBeat[]): EditableGrid | null {
  if (beats.length < 2) return null
  const byTempo = runsOf(beats, true)
  const runs = longEnough(byTempo) ? byTempo : runsOf(beats, false)
  if (runs.length > 1 && !longEnough(runs)) return null
  const tolerance = runs.length === 1 ? Number.POSITIVE_INFINITY : CONSTANT_TOLERANCE_MS
  const pieces: { from: number; grid: EditableGrid }[] = []
  for (const [a, b] of runs) {
    const fitted = fittedPieces(beats.slice(a, b), tolerance)
    if (!fitted) return null
    pieces.push(...fitted.map((piece) => ({ ...piece, from: piece.from + a })))
  }
  const [base, ...rest] = pieces
  if (rest.length === 0) return base.grid
  return {
    ...base.grid,
    zones: rest.map((piece) => ({
      fromMs: beats[piece.from].ms,
      bpm: piece.grid.bpm,
      anchorMs: piece.grid.anchorMs,
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

const CARRY_REACH_MS = (4 * 60000) / GRID_BPM_MIN

const nearestIndex = (beats: number[], ms: number): number =>
  beats.reduce((best, b, i) => (Math.abs(b - ms) < Math.abs(beats[best] - ms) ? i : best), 0)

export function carryOntoGrid(
  from: EditableGrid,
  to: EditableGrid,
  ms: number,
  toleranceMs: number,
): number | null {
  const was = gridBeats(from, ms + CARRY_REACH_MS).map((b) => b.ms)
  const now = gridBeats(to, ms + CARRY_REACH_MS).map((b) => b.ms)
  if (was.length === 0 || now.length === 0) return null
  const at = nearestIndex(was, ms)
  if (Math.abs(was[at] - ms) > toleranceMs) return null
  const counted = at - Math.round((from.anchorMs - was[0]) / periodOf(from.bpm))
  const ratio = zoneAt(to, ms).bpm / zoneAt(from, ms).bpm
  const beat = counted * (ratio > 1.5 ? 2 : ratio < 0.75 ? 0.5 : 1)
  if (!Number.isInteger(beat)) return null
  const target = Math.round((to.anchorMs - now[0]) / periodOf(to.bpm)) + beat
  return target >= 0 && target < now.length ? now[target] : null
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
    const from = i === 0 ? -START_SLACK_MS : boundaryOf(zone)
    const to = i + 1 < zones.length ? boundaryOf(zones[i + 1]) : durationMs
    for (let k = Math.ceil((from - zone.anchorMs) / period); zone.anchorMs + k * period < to; k++)
      out.push({ ms: Math.max(0, zone.anchorMs + k * period), beat: barBeat(k) })
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

const NEIGHBOUR_STRETCHES = 5
const MIN_NEIGHBOUR_STRETCHES = 3
const MIN_DRIFT_STRETCHES = 8

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function steadyStretches(fit: GridFit): { ms: number; d: number }[] {
  const period = periodOf(fit.bpm)
  const fine = fit.fine ?? []
  const reach = LONG_STRETCH_BEATS * period
  const measured = [
    ...fine,
    ...(fit.phases ?? []).filter((p) => !fine.some((f) => Math.abs(f.ms - p.ms) < reach)),
  ].sort((a, b) => a.ms - b.ms)
  return withoutExcursions(
    measured
      .map((p) => ({
        ms: p.ms,
        d: offbeatFolded(p.firstMs - nearestOn(p.firstMs, fit.firstMs, period), period),
      }))
      .filter((p) => Math.abs(p.d) <= period / 8),
  )
}

const LONG_STRETCH_BEATS = 16
const JUMP_MS = 7
const MAX_EXCURSION_MS = 40000
const MIN_HEARD_MS = 10000
const EDGE_STRETCHES = 5

function withoutExcursions(points: Stretch[]): Stretch[] {
  if (points.length === 0) return points
  const cuts = [0]
  for (let i = 1; i < points.length; i++)
    if (Math.abs(points[i].d - points[i - 1].d) > JUMP_MS) cuts.push(i)
  cuts.push(points.length)
  const parts = cuts.slice(1).map((end, i) => points.slice(cuts[i], end))
  const span = (part: Stretch[]) => part[part.length - 1].ms - part[0].ms
  const levelAt = (part: Stretch[]) => median(part.map((p) => p.d))
  const kept = parts.map((part) => span(part) >= MIN_HEARD_MS)
  if (!kept.some(Boolean)) return points
  const trusted = kept.map((k, i) => k && span(parts[i]) >= MAX_EXCURSION_MS)
  const edges = parts.flatMap((part, i) => {
    if (!trusted[i]) return []
    const head = part.slice(0, EDGE_STRETCHES)
    const tail = part.slice(-EDGE_STRETCHES)
    return [
      { ms: head[0].ms, d: levelAt(head) },
      { ms: tail[tail.length - 1].ms, d: levelAt(tail) },
    ]
  })
  const expected = (ms: number): number | null => {
    if (edges.length === 0) return null
    const after = edges.findIndex((e) => e.ms >= ms)
    if (after === 0) return edges[0].d
    if (after < 0) return edges[edges.length - 1].d
    const a = edges[after - 1]
    const b = edges[after]
    return a.d + ((b.d - a.d) * (ms - a.ms)) / (b.ms - a.ms)
  }
  const agrees = (i: number) => {
    const part = parts[i]
    const level = levelAt(part)
    const start = part[0].ms
    const end = part[part.length - 1].ms
    const before = edges.filter((e) => e.ms <= start).at(-1)
    const after = edges.find((e) => e.ms >= end)
    const want = expected((start + end) / 2)
    if (want === null) return true
    return [before?.d, after?.d, want].some(
      (d) => d !== undefined && Math.abs(level - d) <= JUMP_MS,
    )
  }
  return parts.filter((_, i) => kept[i] && (trusted[i] || agrees(i))).flat()
}

function phaseNear(fit: GridFit, ms: number): number {
  const near = steadyStretches(fit)
    .sort((a, b) => Math.abs(a.ms - ms) - Math.abs(b.ms - ms))
    .slice(0, NEIGHBOUR_STRETCHES)
  if (near.length < MIN_NEIGHBOUR_STRETCHES) return fit.firstMs
  return fit.firstMs + median(near.map((p) => p.d))
}

function phaseIn(fit: GridFit, fromMs: number, toMs: number, atMs: number): number | null {
  const inside = steadyStretches(fit).filter((p) => p.ms >= fromMs && p.ms < toMs)
  if (inside.length < MIN_NEIGHBOUR_STRETCHES) return null
  const slope = driftSlope(fit)
  return fit.firstMs + median(inside.map((p) => p.d - slope * p.ms)) + slope * atMs
}

function zoneSpan(grid: EditableGrid, index: number): [number, number] {
  const zones = zonesOf(grid)
  return [
    index === 0 ? Number.NEGATIVE_INFINITY : boundaryOf(zones[index]),
    index + 1 < zones.length ? boundaryOf(zones[index + 1]) : Number.POSITIVE_INFINITY,
  ]
}

function driftSlope(fit: GridFit): number {
  const steady = steadyStretches(fit)
  if (steady.length < MIN_DRIFT_STRETCHES) return 0
  const slopes: number[] = []
  steady.forEach((a, i) => {
    for (const b of steady.slice(i + 1)) if (b.ms !== a.ms) slopes.push((b.d - a.d) / (b.ms - a.ms))
  })
  return slopes.length === 0 ? 0 : median(slopes)
}

function driftCorrectedBpm(fit: GridFit): number {
  return fit.bpm / (1 + driftSlope(fit))
}

const offbeatFolded = (offsetMs: number, period: number): number =>
  Math.abs(offsetMs) > period / 4 ? offsetMs - Math.sign(offsetMs) * (period / 2) : offsetMs

export function fitGrid(
  grid: EditableGrid,
  fit: GridFit,
  atMs?: number,
  kicks: number[] = [],
): EditableGrid {
  const first =
    atMs === undefined
      ? fit.firstMs
      : (phaseIn(fit, ...zoneSpan(grid, zoneIndexAt(grid, atMs)), atMs) ?? phaseNear(fit, atMs))
  const bpm = driftCorrectedBpm(fit)
  const fitted = editAt(grid, atMs ?? 0, (zone) => {
    const sameTempo = Math.abs(bpm - zone.bpm) / zone.bpm < SAME_TEMPO_RATIO
    const tempo = sameTempo ? bpm : zone.bpm
    const at = atMs ?? first
    const heard = nearestOn(at, first, periodOf(fit.bpm))
    const off =
      heard -
      (kicks.length >= 2
        ? nearestBeatMs(heard, kicks)
        : nearestOn(heard, zone.anchorMs, periodOf(zone.bpm)))
    const beatAt = heard - off + offbeatFolded(off, periodOf(fit.bpm))
    return {
      bpm: tempo,
      anchorMs: nearestOn(zone.anchorMs, beatAt, periodOf(tempo)),
    }
  })
  return fitted ?? grid
}

const BREAK_MS = 5
const BREAK_RUN = 3
const MIN_RUN_STRETCHES = 6

type Stretch = { ms: number; d: number }

function lineOf(points: Stretch[]): { at: (ms: number) => number; slope: number; sse: number } {
  const meanMs = points.reduce((sum, p) => sum + p.ms, 0) / points.length
  const meanD = points.reduce((sum, p) => sum + p.d, 0) / points.length
  let num = 0
  let den = 0
  for (const p of points) {
    num += (p.ms - meanMs) * (p.d - meanD)
    den += (p.ms - meanMs) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  const at = (ms: number) => meanD + slope * (ms - meanMs)
  return { at, slope, sse: points.reduce((sum, p) => sum + (p.d - at(p.ms)) ** 2, 0) }
}

function breaksAway(points: Stretch[]): boolean {
  const { at } = lineOf(points)
  const sides = points.map((p) => {
    const off = p.d - at(p.ms)
    return Math.abs(off) > BREAK_MS ? Math.sign(off) : 0
  })
  return sides.some(
    (side, i) =>
      side !== 0 && sides.slice(i, i + BREAK_RUN).filter((s) => s === side).length === BREAK_RUN,
  )
}

function splitRuns(points: Stretch[]): Stretch[][] {
  if (points.length < 2 * MIN_RUN_STRETCHES || !breaksAway(points)) return [points]
  let best = 0
  let bestCost = Number.POSITIVE_INFINITY
  for (let at = MIN_RUN_STRETCHES; at <= points.length - MIN_RUN_STRETCHES; at++) {
    const cost = lineOf(points.slice(0, at)).sse + lineOf(points.slice(at)).sse
    if (cost < bestCost) {
      bestCost = cost
      best = at
    }
  }
  return [...splitRuns(points.slice(0, best)), ...splitRuns(points.slice(best))]
}

export function autoFitGrid(
  grid: EditableGrid,
  fit: GridFit,
  atMs: number,
  kicks: number[],
  zones: boolean,
): EditableGrid {
  const { zones: _, ...base } = grid
  const sameTempo = Math.abs(fit.bpm - grid.bpm) / grid.bpm < SAME_TEMPO_RATIO
  const runs = zones && sameTempo ? splitRuns(steadyStretches(fit)) : []
  if (runs.length < 2)
    return zones ? fitGrid(base, fit, atMs, kicks) : fitGrid(grid, fit, atMs, kicks)
  const fitPeriod = periodOf(fit.bpm)
  const lines = runs.map((run) => {
    const { at, slope } = lineOf(run)
    return { period: fitPeriod * (1 + slope), phaseAt: (ms: number) => fit.firstMs + at(ms) }
  })
  const firstMs = runs[0][0].ms
  const heard = nearestOn(firstMs, lines[0].phaseAt(firstMs), fitPeriod)
  const off =
    heard -
    (kicks.length >= 2
      ? nearestBeatMs(heard, kicks)
      : nearestOn(heard, grid.anchorMs, periodOf(grid.bpm)))
  const beatAt = heard - off + offbeatFolded(off, fitPeriod)
  const first = {
    bpm: 60000 / lines[0].period,
    anchorMs: nearestOn(grid.anchorMs, beatAt, lines[0].period),
  }
  const out: GridZone[] = []
  let previous: EditableGrid = first
  lines.slice(1).forEach((line, i) => {
    const startMs = (runs[i][runs[i].length - 1].ms + runs[i + 1][0].ms) / 2
    const period = periodOf(previous.bpm)
    const k = Math.round((startMs - previous.anchorMs) / period)
    const beatMs = previous.anchorMs + k * period
    const near = nearestOn(beatMs, line.phaseAt(beatMs), fitPeriod)
    const fromMs = beatMs + offbeatFolded(near - beatMs, fitPeriod)
    const zone = {
      fromMs,
      bpm: 60000 / line.period,
      anchorMs: fromMs - (barBeat(k) - 1) * line.period,
    }
    out.push(zone)
    previous = zone
  })
  return { ...first, zones: out }
}

export function gridOffsets(
  beats: number[],
  fit: GridFit,
  playheadMs: number,
  durationMs: number,
  kicks: number[] = beats,
): { hereMs: number; endMs: number } {
  const offsetAt = (ms: number): number => {
    const beat = nearestBeatMs(ms, beats)
    return Math.round(beat - detectedBeatNear(fit, beat, kicks))
  }
  return { hereMs: offsetAt(playheadMs), endMs: offsetAt(durationMs) }
}

export function gridFingerprint(grid: { ms: number; beat: number }[]): string {
  return grid.map((b) => `${b.ms}|${b.beat}`).join(';')
}

export function detectedBeatNear(fit: GridFit, ms: number, beats: number[]): number {
  const period = periodOf(fit.bpm)
  const heard = nearestOn(ms, phaseNear(fit, ms), period)
  if (beats.length < 2) return heard
  const off = heard - nearestBeatMs(heard, beats)
  return nearestOn(ms, heard - off + offbeatFolded(off, period), period)
}

export function pinGrid(
  grid: EditableGrid,
  pins: number[],
  ms: number,
  zones: boolean,
): EditableGrid | null {
  const index = zoneIndexAt(grid, ms)
  const inZone = pins.filter((p) => zoneIndexAt(grid, p) === index)
  if (inZone.length === 0)
    return editAt(grid, ms, (zone) =>
      shiftGrid(zone, ms - nearestOn(ms, zone.anchorMs, periodOf(zone.bpm))),
    )
  const pivot = inZone.reduce((best, p) => (Math.abs(p - ms) < Math.abs(best - ms) ? p : best))
  const base =
    zones && inZone.length >= 2 && !anchorNear(grid, pivot) ? toggleAnchor(grid, pivot) : grid
  return editAt(base, ms, (zone) => {
    const n = Math.round((ms - pivot) / periodOf(zone.bpm))
    return n === 0 ? null : retempoGrid(zone, (60000 * n) / (ms - pivot), pivot)
  })
}
