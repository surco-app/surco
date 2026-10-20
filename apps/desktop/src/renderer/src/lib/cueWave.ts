import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat, SAME_POSITION_MS } from '../../../shared/cueRules'

export const HOT_LETTER: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  5: 'D',
  6: 'E',
  7: 'F',
  8: 'G',
  9: 'H',
  10: 'I',
  11: 'J',
  12: 'K',
  13: 'L',
  14: 'M',
  15: 'N',
  16: 'O',
  17: 'P',
}

export function barLines(grid: { ms: number; beat: number }[]): { ms: number; strong: boolean }[] {
  const downbeats = grid.filter((b) => b.beat === 1)
  return downbeats.map((b, i) => ({ ms: b.ms, strong: i % 16 === 0 }))
}

export function quantizePoints(grid: { ms: number; beat: number }[], unit: CueQuantize): number[] {
  const downbeats = grid.filter((b) => b.beat === 1)
  const points = unit === 'bar' && downbeats.length > 0 ? downbeats : grid
  return points.map((b) => b.ms)
}

export function clickAction(
  ms: number,
  beatsMs: number[],
  drops: number[],
  toleranceMs: number,
): { kind: 'add' | 'remove'; ms: number } {
  const nearestTo = (target: number, within: number): number | undefined =>
    drops
      .filter((d) => Math.abs(d - target) <= within)
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0]
  const hit = nearestTo(ms, toleranceMs)
  if (hit !== undefined) return { kind: 'remove', ms: hit }
  const beat = beatsMs[nearestBeat(beatsMs, ms)]
  const same = nearestTo(beat, SAME_POSITION_MS)
  if (same !== undefined) return { kind: 'remove', ms: same }
  return { kind: 'add', ms: beat }
}

export function peakBars(values: number[], count: number): number[] {
  if (values.length <= count) return values
  return Array.from({ length: count }, (_, i) => {
    const from = Math.floor((i * values.length) / count)
    const to = Math.floor(((i + 1) * values.length) / count)
    return Math.max(...values.slice(from, to))
  })
}

export function cuePosition(
  ms: number,
  grid: { ms: number; beat: number }[],
): { time: string; bar: string } {
  const index = nearestBeat(
    grid.map((b) => b.ms),
    ms,
  )
  const bar = grid.slice(0, index + 1).filter((b) => b.beat === 1).length
  const whole = Math.round(ms)
  const minutes = Math.floor(whole / 60000)
  const seconds = String(Math.floor((whole % 60000) / 1000)).padStart(2, '0')
  const millis = String(whole % 1000).padStart(3, '0')
  return { time: `${minutes}:${seconds}.${millis}`, bar: `${bar}.${grid[index]?.beat ?? 1}` }
}
