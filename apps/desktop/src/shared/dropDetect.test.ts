import { describe, expect, it } from 'vitest'
import type { FlowPhrase, PhraseKind } from './cueFlows'
import {
  type DropInput,
  type DropModel,
  detectDrops,
  dropCandidates,
  dropProposals,
  pickDrops,
  SURE_SCORE,
} from './dropDetect'

const BAR_MS = 2000
const ENTRIES_PER_BAR = (BAR_MS * 150) / 1000

type Section = [bars: number, height: number, low: number]

function word(height: number, low: number): number {
  return (low << 13) | (3 << 10) | (2 << 7) | (height << 2)
}

function track(sections: Section[], phrases: [bar: number, kind: PhraseKind][] = []): DropInput {
  const total = sections.reduce((n, [bars]) => n + bars, 0)
  const words = new Uint16Array(total * ENTRIES_PER_BAR)
  let at = 0
  for (const [bars, height, low] of sections) {
    words.fill(word(height, low), at, at + bars * ENTRIES_PER_BAR)
    at += bars * ENTRIES_PER_BAR
  }
  const grid = Array.from({ length: total * 4 }, (_, i) => ({
    ms: (i * BAR_MS) / 4,
    beat: (i % 4) + 1,
  }))
  const flow: FlowPhrase[] = phrases.map(([bar, kind]) => ({ ms: bar * BAR_MS, kind }))
  return { grid, phrases: flow, words }
}

const FULL: [number, number] = [26, 7]
const BREAK: [number, number] = [12, 0]
const INTRO: [number, number] = [10, 1]

describe('detectDrops', () => {
  it('proposes the bar where the bass comes back after a long breakdown', () => {
    const input = track(
      [
        [16, ...INTRO],
        [32, ...FULL],
        [16, ...BREAK],
        [32, ...FULL],
        [16, ...BREAK],
        [32, ...FULL],
      ],
      [
        [0, 'intro'],
        [16, 'chorus'],
        [48, 'down'],
        [64, 'chorus'],
        [96, 'down'],
        [112, 'chorus'],
      ],
    )
    const drops = detectDrops(input)
    expect(drops).toContain(64 * BAR_MS)
    expect(drops).toContain(112 * BAR_MS)
  })

  it('finds the return from the breakdown without rekordbox phrases, but nothing inside it', () => {
    const input = track([
      [16, ...INTRO],
      [32, ...FULL],
      [32, ...BREAK],
      [32, ...FULL],
    ])
    const drops = detectDrops(input)
    expect(drops).toContain(80 * BAR_MS)
    for (const ms of drops) expect(ms <= 48 * BAR_MS || ms >= 80 * BAR_MS).toBe(true)
  })

  it('answers nothing when there is no grid to count bars on', () => {
    expect(detectDrops({ grid: [], phrases: [], words: new Uint16Array(0) })).toEqual([])
  })
})

describe('dropCandidates', () => {
  it('only weighs bars where a phrase starts or the bass jumps back, to keep the guesses few', () => {
    const input = track(
      [
        [16, ...FULL],
        [8, ...BREAK],
        [16, ...FULL],
      ],
      [[8, 'up']],
    )
    expect(dropCandidates(input).map((c) => c.bar)).toEqual([0, 8, 9, 24])
  })
})

describe('pickDrops', () => {
  const scored = [
    { bar: 32, ms: 64000, score: 2 },
    { bar: 40, ms: 80000, score: 1.5 },
    { bar: 96, ms: 192000, score: 1 },
    { bar: 160, ms: 320000, score: -3 },
  ]

  it('orders by confidence and keeps drops apart, since two drops never sit a few bars apart', () => {
    expect(pickDrops(scored, { threshold: 0, spacingBars: 16, maxDrops: 4 })).toEqual([
      64000, 192000,
    ])
  })

  it('stops at the most drops a track usually has', () => {
    expect(pickDrops(scored, { threshold: -5, spacingBars: 1, maxDrops: 2 })).toEqual([
      64000, 80000,
    ])
  })

  it('still offers the best guess when nothing clears the bar, because every track breaks somewhere', () => {
    expect(pickDrops(scored, { threshold: 5, spacingBars: 16, maxDrops: 4 })).toEqual([64000])
  })
})

describe('dropProposals', () => {
  const input = track([
    [16, ...INTRO],
    [32, ...FULL],
    [12, ...BREAK],
    [32, ...FULL],
  ])
  const flat = (score: number): DropModel => ({
    base: score,
    trees: [],
    picking: { threshold: -5, spacingBars: 16, maxDrops: 4 },
  })

  it('proposes where detectDrops does, so the confidence never changes what Auto finds', () => {
    expect(dropProposals(input).map((p) => p.ms)).toEqual(detectDrops(input))
  })

  it('calls a proposal sure only from the detector’s score, the one thing that separated right from wrong on held-out tracks', () => {
    expect(dropProposals(input, flat(SURE_SCORE)).every((p) => p.sure)).toBe(true)
    expect(dropProposals(input, flat(SURE_SCORE - 0.01)).some((p) => p.sure)).toBe(false)
  })

  it('counts the bars of weak bass right before, so the editor can say what it heard', () => {
    const back = dropProposals(input, flat(0)).find((p) => p.ms === 60 * BAR_MS)
    expect(back?.quietBars).toBe(12)
  })
})
