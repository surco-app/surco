import { nearestBeat } from '../../../shared/cueRules'

export const CUE_COLOR: Record<number, string> = {
  1: 'var(--color-accent)',
  22: 'var(--color-good)',
  42: 'var(--color-danger)',
  32: 'var(--color-warn)',
}

export const HOT_LETTER: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  5: 'D',
  6: 'E',
  7: 'F',
  8: 'G',
  9: 'H',
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
  const hit = drops.find((d) => Math.abs(d - ms) <= toleranceMs)
  if (hit !== undefined) return { kind: 'remove', ms: hit }
  return { kind: 'add', ms: beatsMs[nearestBeat(beatsMs, ms)] }
}
