import { describe, expect, it } from 'vitest'
import { phraseCount, phrasedComment, withPhraseCount } from './phraseCount'

const BEAT = 60000 / 128
const steady = (beats: number) =>
  Array.from({ length: beats }, (_, i) => ({ ms: 120 + i * BEAT, beat: (i % 4) + 1 }))
const call = (grid: { ms: number }[], beat: number, driftMs = 0) => ({
  ms: grid[beat].ms + driftMs,
  kind: 0,
})

describe('phraseCount', () => {
  it('counts whole 32-beat phrases between consecutive CALLs, so two tracks with the same numbers drop together', () => {
    const grid = steady(900)
    const cues = [0, 64, 320, 576].map((b) => call(grid, b))
    expect(phraseCount(cues, grid)).toBe('2 - 8 - 8')
  })

  it('writes the spare beats in brackets when a stretch is not a whole number of phrases', () => {
    const grid = steady(900)
    const cues = [0, 64, 304, 564].map((b) => call(grid, b))
    expect(phraseCount(cues, grid)).toBe('2 - 7 (16) - 8 (4)')
  })

  it('rounds up to the next phrase past 16 spare beats and writes what is missing, because 8 (-4) reads closer to the truth than 7 (28)', () => {
    const grid = steady(400)
    const cues = [0, 252].map((b) => call(grid, b))
    expect(phraseCount(cues, grid)).toBe('8 (-4)')
  })

  it('ignores hot cues and loops, since only the memory cues mark where the track breaks', () => {
    const grid = steady(400)
    const cues = [
      call(grid, 0),
      { ...call(grid, 32), kind: 1 },
      { ...call(grid, 48), kind: 0, loop: true },
      call(grid, 128),
    ]
    expect(phraseCount(cues, grid)).toBe('4')
  })

  it('snaps a CALL a few milliseconds off the beat to that beat, since rekordbox rounds cue times to the millisecond', () => {
    const grid = steady(400)
    const cues = [call(grid, 0, 3), call(grid, 64, -4)]
    expect(phraseCount(cues, grid)).toBe('2')
  })

  it('counts beats on the grid rather than time, so a tempo change inside a stretch does not bend the count', () => {
    const slow = Array.from({ length: 64 }, (_, i) => ({ ms: i * 500, beat: (i % 4) + 1 }))
    const fast = Array.from({ length: 64 }, (_, i) => ({ ms: 32000 + i * 400, beat: (i % 4) + 1 }))
    const grid = [...slow, ...fast]
    expect(phraseCount([call(grid, 0), call(grid, 96)], grid)).toBe('3')
  })

  it('sorts the CALLs by position, because programs list them in the order they were placed', () => {
    const grid = steady(400)
    const cues = [128, 0, 64].map((b) => call(grid, b))
    expect(phraseCount(cues, grid)).toBe('2 - 2')
  })

  it('counts two CALLs on the same beat as one, so a doubled cue does not add a 0 stretch', () => {
    const grid = steady(400)
    const cues = [0, 64, 64].map((b) => call(grid, b))
    expect(phraseCount(cues, grid)).toBe('2')
  })

  it('has nothing to count with fewer than two CALLs or without a grid', () => {
    const grid = steady(400)
    expect(phraseCount([call(grid, 0)], grid)).toBeNull()
    expect(phraseCount([call(grid, 0), call(grid, 64)], [])).toBeNull()
  })
})

describe('withPhraseCount', () => {
  it('puts the count in front of the comment, so it reads first in the comment column', () => {
    expect(withPhraseCount('Vocal fuerte', '2 - 8 - 8')).toBe('2 - 8 - 8 · Vocal fuerte')
  })

  it('fills an empty comment with the count alone', () => {
    expect(withPhraseCount('', '2 - 8')).toBe('2 - 8')
  })

  it('replaces the count it wrote before instead of piling a second one in front', () => {
    expect(withPhraseCount('2 - 7 (16) - 8 (4) · Vocal fuerte', '2 - 8 (-4)')).toBe(
      '2 - 8 (-4) · Vocal fuerte',
    )
    expect(withPhraseCount('2 - 8', '4 - 8')).toBe('4 - 8')
  })

  it('leaves a comment that only starts with a number alone, since that number is the DJ’s own note', () => {
    expect(withPhraseCount('128 BPM vocal', '2 - 8')).toBe('2 - 8 · 128 BPM vocal')
  })
})

describe('phrasedComment', () => {
  it('prepends like withPhraseCount so today\u2019s saves keep working', () => {
    expect(phrasedComment('Remix vinilo 2019', '2 - 8', 'prepend')).toBe(
      '2 - 8 \u00b7 Remix vinilo 2019',
    )
    expect(phrasedComment('1 - 4 \u00b7 Remix vinilo 2019', '2 - 8', 'prepend')).toBe(
      '2 - 8 \u00b7 Remix vinilo 2019',
    )
  })

  it('replaces the whole comment with the count when asked, as Enrique wants', () => {
    expect(phrasedComment('Remix vinilo 2019', '2 - 8', 'replace')).toBe('2 - 8')
    expect(phrasedComment('', '2 - 8', 'replace')).toBe('2 - 8')
  })

  it('keeps rekordbox\u2019s My Tags block on replace, so the tags still show in its comment', () => {
    expect(phrasedComment('Remix vinilo 2019 /* Base / Melodia */', '2 - 8', 'replace')).toBe(
      '2 - 8 \u00b7 /* Base / Melodia */',
    )
    expect(phrasedComment('1 - 4 \u00b7 Remix /* Base */', '2 - 8', 'replace')).toBe(
      '2 - 8 \u00b7 /* Base */',
    )
  })
})
