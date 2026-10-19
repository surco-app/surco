import { nearestBeat, SAME_POSITION_MS } from '../../../shared/cueRules'

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
  10: 'I',
  11: 'J',
  12: 'K',
  13: 'L',
  14: 'M',
  15: 'N',
  16: 'O',
  17: 'P',
}

export const UNKNOWN_CUE_COLOR = 'var(--color-fg-faint)'

export function cueColor(color: number | null): string {
  return (color === null ? undefined : CUE_COLOR[color]) ?? UNKNOWN_CUE_COLOR
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
