import type { CueWaveColumn } from '../../../shared/types'

export const PWV5_PER_SECOND = 150

export type DetailSource = { words: Uint16Array } | { wave: CueWaveColumn[]; durationMs: number }

const level = (v: number): number => Math.round((v / 7) * 255)

export function decodeWaveWord(word: number): CueWaveColumn {
  return {
    h: ((word >> 2) & 0x1f) / 31,
    rgb: [level((word >> 13) & 7), level((word >> 10) & 7), level((word >> 7) & 7)],
  }
}

function entries(source: DetailSource): {
  count: number
  perMs: number
  at: (i: number) => CueWaveColumn
} {
  if ('words' in source)
    return {
      count: source.words.length,
      perMs: PWV5_PER_SECOND / 1000,
      at: (i) => decodeWaveWord(source.words[i]),
    }
  return {
    count: source.wave.length,
    perMs: source.wave.length / Math.max(source.durationMs, 1),
    at: (i) => source.wave[i],
  }
}

export function visibleColumns(
  source: DetailSource,
  fromMs: number,
  toMs: number,
  width: number,
): (CueWaveColumn | null)[] {
  const { count, perMs, at } = entries(source)
  const step = (toMs - fromMs) / Math.max(width, 1)
  return Array.from({ length: Math.max(width, 0) }, (_, x) => {
    const from = Math.floor((fromMs + x * step) * perMs)
    const to = Math.max(from + 1, Math.floor((fromMs + (x + 1) * step) * perMs))
    let best: CueWaveColumn | null = null
    for (let i = Math.max(from, 0); i < Math.min(to, count); i++) {
      const column = at(i)
      if (!best || column.h > best.h) best = column
    }
    return best
  })
}
