import type { CueWaveColumn } from '../../../shared/types'

export const PWV5_PER_SECOND = 150
export const BODY_ENTRIES = 7
const LAYER_ALPHA = { peak: 0.45, body: 0.85 }

export type DetailSource = { words: Uint16Array } | { wave: CueWaveColumn[]; durationMs: number }

export interface WaveLevel {
  peak: number
  body: number
}

function entries(source: DetailSource): {
  count: number
  perMs: number
  at: (i: number) => number
} {
  if ('words' in source)
    return {
      count: source.words.length,
      perMs: PWV5_PER_SECOND / 1000,
      at: (i) => ((source.words[i] >> 2) & 0x1f) / 31,
    }
  return {
    count: source.wave.length,
    perMs: source.wave.length / Math.max(source.durationMs, 1),
    at: (i) => source.wave[i].h,
  }
}

export function waveColumns(
  source: DetailSource,
  fromMs: number,
  toMs: number,
  width: number,
): (WaveLevel | null)[] {
  const { count, perMs, at } = entries(source)
  const step = (toMs - fromMs) / Math.max(width, 1)
  const half = Math.floor(BODY_ENTRIES / 2)
  const first = Math.max(Math.floor(fromMs * perMs) - half, 0)
  const last = Math.min(Math.ceil(toMs * perMs) + half + 1, count)
  const squares = new Float64Array(Math.max(last - first + 1, 1))
  for (let i = first; i < last; i++) squares[i - first + 1] = squares[i - first] + at(i) ** 2
  const body = (i: number): number => {
    const lo = Math.max(i - half, first)
    const hi = Math.min(i + half + 1, last)
    return Math.sqrt((squares[hi - first] - squares[lo - first]) / BODY_ENTRIES)
  }
  return Array.from({ length: Math.max(width, 0) }, (_, x) => {
    const from = Math.floor((fromMs + x * step) * perMs)
    const to = Math.max(from + 1, Math.floor((fromMs + (x + 1) * step) * perMs))
    let level: WaveLevel | null = null
    for (let i = Math.max(from, 0); i < Math.min(to, count); i++) {
      const peak = at(i)
      const loud = Math.min(body(i), peak)
      if (!level) level = { peak, body: loud }
      else level = { peak: Math.max(level.peak, peak), body: Math.max(level.body, loud) }
    }
    return level
  })
}

export function paintWave(
  g: CanvasRenderingContext2D,
  columns: (WaveLevel | null)[],
  height: number,
  colours: { peak: string; body: string },
  span = 1,
): void {
  for (const [layer, colour] of [
    ['peak', colours.peak],
    ['body', colours.body],
  ] as const) {
    g.fillStyle = colour
    g.globalAlpha = LAYER_ALPHA[layer]
    columns.forEach((column, x) => {
      if (!column) return
      const h = Math.max(column[layer] * height * span, 1)
      g.fillRect(x, (height - h) / 2, 1, h)
    })
  }
}
