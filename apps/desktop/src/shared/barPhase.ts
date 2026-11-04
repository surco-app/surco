const WORDS_PER_MS = 150 / 1000
const BEATS_PER_BAR = 4
const WINDOW_BEATS = 8

type Beat = { ms: number; beat: number }

function bassPerBeat(words: Uint16Array, grid: Beat[]): number[] {
  return grid.map((b, i) => {
    const end = grid[i + 1]?.ms ?? b.ms + (b.ms - (grid[i - 1]?.ms ?? b.ms))
    let sum = 0
    let count = 0
    const to = Math.floor(end * WORDS_PER_MS)
    for (let k = Math.floor(b.ms * WORDS_PER_MS); k < to && k < words.length; k++) {
      const w = words[k]
      sum += (((w >> 2) & 31) * ((w >> 13) & 7)) / 7
      count++
    }
    return count ? sum / count : 0
  })
}

function mean(values: number[], from: number, to: number): number {
  let sum = 0
  for (let k = from; k < to; k++) sum += values[k]
  return sum / (to - from)
}

export function withBars<T extends Beat>(grid: T[], words: Uint16Array | null): T[] {
  if (!words || words.length === 0) return grid
  const bass = bassPerBeat(words, grid)
  const score = Array<number>(BEATS_PER_BAR).fill(0)
  for (let i = WINDOW_BEATS; i < bass.length - WINDOW_BEATS; i++) {
    const change = mean(bass, i, i + WINDOW_BEATS) - mean(bass, i - WINDOW_BEATS, i)
    score[i % BEATS_PER_BAR] += change * change
  }
  const phase = score.indexOf(Math.max(...score))
  return grid.map((b, i) => ({
    ...b,
    beat: ((((i - phase) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR) + 1,
  }))
}
