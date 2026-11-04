import { describe, expect, it } from 'vitest'
import { withBars } from './barPhase'

const PERIOD = 500
const grid = (n: number) => Array.from({ length: n }, (_, i) => ({ ms: 40 + i * PERIOD, beat: 0 }))
const WORDS_PER_MS = 150 / 1000

function wordsWithBassFrom(
  beats: { ms: number }[],
  bassOn: (beat: number) => boolean,
): Uint16Array {
  const words = new Uint16Array(Math.ceil((beats[beats.length - 1].ms + PERIOD) * WORDS_PER_MS))
  beats.forEach((b, i) => {
    const from = Math.floor(b.ms * WORDS_PER_MS)
    const to = Math.floor((b.ms + PERIOD) * WORDS_PER_MS)
    const low = bassOn(i) ? 7 : 1
    for (let k = from; k < to; k++) words[k] = (low << 13) | (20 << 2)
  })
  return words
}

const downbeats = (g: { beat: number }[]) => g.flatMap((b, i) => (b.beat === 1 ? [i] : []))

describe('withBars', () => {
  it('starts the bars where the bass comes in and goes out, since a dance track changes its bass on a bar', () => {
    const beats = grid(256)
    const words = wordsWithBassFrom(beats, (i) => Math.floor((i - 2) / 32) % 2 === 1)
    const out = withBars(beats, words)
    expect(downbeats(out).slice(0, 3)).toEqual([2, 6, 10])
    expect(out.map((b) => b.beat).slice(0, 6)).toEqual([3, 4, 1, 2, 3, 4])
  })

  it('keeps the beats where they are', () => {
    const beats = grid(256)
    const words = wordsWithBassFrom(beats, (i) => Math.floor((i - 1) / 64) % 2 === 1)
    expect(withBars(beats, words).map((b) => b.ms)).toEqual(beats.map((b) => b.ms))
    expect(downbeats(withBars(beats, words))[0]).toBe(1)
  })

  it('leaves the grid unnumbered when there is no waveform to hear the bass in', () => {
    const beats = grid(256)
    expect(withBars(beats, null)).toBe(beats)
  })
})
