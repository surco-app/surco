import { describe, expect, it } from 'vitest'
import { pairKey, suggestPairs } from './matchingSuggestions'

const none = new Set<string>()

describe('suggestPairs', () => {
  it('suggests two tracks played back to back in at least three sets', () => {
    const sets = [
      ['a', 'b'],
      ['x', 'a', 'b'],
      ['b', 'a', 'y'],
    ]
    expect(suggestPairs(sets, [], none)).toEqual([{ pair: ['a', 'b'], times: 3 }])
  })

  it('counts the pair in either order, since a Matching pair has none', () => {
    expect(
      suggestPairs(
        [
          ['a', 'b'],
          ['b', 'a'],
          ['a', 'b'],
        ],
        [],
        none,
      )[0].times,
    ).toBe(3)
  })

  it('leaves out a pair played together only twice, which can be chance', () => {
    expect(
      suggestPairs(
        [
          ['a', 'b'],
          ['a', 'b'],
          ['a', 'c'],
        ],
        [],
        none,
      ),
    ).toEqual([])
  })

  it('counts a pair once per set even if the set repeats it', () => {
    expect(suggestPairs([['a', 'b', 'a', 'b', 'a', 'b']], [], none)).toEqual([])
  })

  it('leaves out a pair the DJ already marked in rekordbox, in either deck order', () => {
    const sets = [
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
    ]
    expect(suggestPairs(sets, [['b', 'a']], none)).toEqual([])
  })

  it('leaves out a pair the DJ dismissed', () => {
    const sets = [
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
    ]
    expect(suggestPairs(sets, [], new Set([pairKey('b', 'a')]))).toEqual([])
  })

  it('puts the pairs played together most often first', () => {
    const sets = [
      ['c', 'd'],
      ['c', 'd'],
      ['c', 'd'],
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
    ]
    expect(suggestPairs(sets, [], none).map((s) => s.times)).toEqual([4, 3])
  })

  it('never pairs a track with itself, as when it was loaded twice in a row', () => {
    expect(
      suggestPairs(
        [
          ['a', 'a'],
          ['a', 'a'],
          ['a', 'a'],
        ],
        [],
        none,
      ),
    ).toEqual([])
  })
})
