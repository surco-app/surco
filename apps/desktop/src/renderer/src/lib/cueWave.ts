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

const LABEL_SPAN = 0.12

export function dropLabels(
  drops: number[],
  durationMs: number,
): { ms: number; side: 'left' | 'right'; row: 0 | 1 }[] {
  const rows: [number, number][][] = [[], []]
  let previous: 0 | 1 = 1
  return [...drops]
    .sort((a, b) => a - b)
    .map((ms) => {
      const at = ms / Math.max(durationMs, 1)
      const side = at > 1 - LABEL_SPAN ? 'left' : 'right'
      const span: [number, number] =
        side === 'right' ? [at, at + LABEL_SPAN] : [at - LABEL_SPAN, at]
      const free = ([0, 1] as const).find((r) =>
        rows[r].every(([a, b]) => span[1] <= a || span[0] >= b),
      )
      const row = free ?? (previous === 0 ? 1 : 0)
      rows[row].push(span)
      previous = row
      return { ms, side, row }
    })
}
