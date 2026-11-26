import type { CueQuantize } from '../../../shared/cueQuantize'
import { nearestBeat } from '../../../shared/cueRules'

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

export function barLines(grid: { ms: number; beat: number }[]): { ms: number }[] {
  return grid.filter((b) => b.beat === 1).map((b) => ({ ms: b.ms }))
}

// A file that starts mid-kick puts that kick's beat a few ms before 0, where no grid can
// hold it (rekordbox's own starts on the next beat), so the DJ sees the first kick with no
// line. Drawing it at 0 is only for the eye: snapping and saving keep the real grid. Past
// this reach the beat lies too far back for 0 to look like that kick.
const CUT_KICK_MS = 20

export function withCutFirstBeat(
  grid: { ms: number; beat: number }[],
): { ms: number; beat: number }[] {
  if (grid.length < 2 || grid[0].ms <= 0) return grid
  const before = grid[0].ms - (grid[1].ms - grid[0].ms)
  if (before > 0 || before < -CUT_KICK_MS) return grid
  return [{ ms: 0, beat: grid[0].beat === 1 ? 4 : grid[0].beat - 1 }, ...grid]
}

export function quantizePoints(grid: { ms: number; beat: number }[], unit: CueQuantize): number[] {
  const downbeats = grid.filter((b) => b.beat === 1)
  const points = unit === 'bar' && downbeats.length > 0 ? downbeats : grid
  return points.map((b) => b.ms)
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
