import { describe, expect, it } from 'vitest'
import { matchingBlocks, pairsOfBlocks, withBlockSeparators } from './matchingBlocks'
import type { SourcePlaylistEntry } from './types'

const byId = (id: string): string => id

describe('matchingBlocks', () => {
  it('keeps unrelated pairs apart so each block is a set the DJ can play straight through', () => {
    expect(
      matchingBlocks(
        [
          ['a', 'b'],
          ['x', 'y'],
        ],
        byId,
      ),
    ).toEqual([
      ['a', 'b'],
      ['x', 'y'],
    ])
  })

  it('collapses a pair rekordbox holds in both deck orders into one link', () => {
    expect(
      matchingBlocks(
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
        byId,
      ),
    ).toEqual([['a', 'b']])
  })

  it('puts longer blocks first so the richest runs are on top', () => {
    expect(
      matchingBlocks(
        [
          ['a', 'b'],
          ['x', 'y'],
          ['x', 'z'],
        ],
        byId,
      ),
    ).toEqual([
      ['x', 'y', 'z'],
      ['a', 'b'],
    ])
  })

  it('ignores a pair of a track with itself', () => {
    expect(matchingBlocks([['a', 'a']], byId)).toEqual([])
  })

  it('keeps the saved order of a pair, because the first track is the one played first', () => {
    const titles: Record<string, string> = { '9': 'Acid Groove', '1': 'Take Me Home' }
    expect(matchingBlocks([['1', '9']], (id) => titles[id])).toEqual([['1', '9']])
  })

  it('stops at one level, so A→B, A→C, C→D reads as A, B, C and C, D', () => {
    expect(
      matchingBlocks(
        [
          ['a', 'b'],
          ['a', 'c'],
          ['c', 'd'],
        ],
        byId,
      ),
    ).toEqual([
      ['a', 'b', 'c'],
      ['c', 'd'],
    ])
  })

  it('puts the followers in the order the pairs were saved, not by title', () => {
    expect(
      matchingBlocks(
        [
          ['hub', 'z'],
          ['hub', 'a'],
        ],
        byId,
      ),
    ).toEqual([['hub', 'z', 'a']])
  })

  it('gives a track played after two others a place in both blocks', () => {
    expect(
      matchingBlocks(
        [
          ['x', 'a'],
          ['y', 'a'],
        ],
        byId,
      ),
    ).toEqual([
      ['x', 'a'],
      ['y', 'a'],
    ])
  })
})

describe('pairsOfBlocks', () => {
  const pairs: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['x', 'y'],
  ]

  it('takes every pair of the block a chosen head leads, and leaves the block its follower leads, because one level means A then B and B then C are two blocks', () => {
    expect(pairsOfBlocks(pairs, ['a'])).toEqual([['a', 'b']])
  })

  it('takes both the block a track leads and the block it follows in, so it leaves Matching entirely', () => {
    expect(pairsOfBlocks(pairs, ['b'])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
  })

  it('empties every block a follower sits in, with all their other followers, since the DJ removes the whole block', () => {
    expect(
      pairsOfBlocks(
        [
          ['x', 'a'],
          ['y', 'a'],
          ['x', 'b'],
          ['z', 'c'],
        ],
        ['a'],
      ),
    ).toEqual([
      ['x', 'a'],
      ['y', 'a'],
      ['x', 'b'],
    ])
  })

  it('leaves blocks with no chosen track alone, because the DJ only asked to remove the ones they selected', () => {
    expect(pairsOfBlocks(pairs, ['y'])).toEqual([['x', 'y']])
  })

  it('returns nothing for tracks without a pair, so a stray selection writes nothing to rekordbox', () => {
    expect(pairsOfBlocks(pairs, ['z'])).toEqual([])
  })

  it('lists a pair once when two chosen tracks share its block, so rekordbox is not asked to remove it twice', () => {
    expect(pairsOfBlocks(pairs, ['a', 'b', 'c'])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
  })

  it('takes a pair held in both deck orders both ways, so the block does not come back from the other order', () => {
    expect(
      pairsOfBlocks(
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
        ['a'],
      ),
    ).toEqual([
      ['a', 'b'],
      ['b', 'a'],
    ])
  })

  it('ignores a pair of a track with itself', () => {
    expect(pairsOfBlocks([['a', 'a']], ['a'])).toEqual([])
  })
})

describe('withBlockSeparators', () => {
  const entry = (path: string): SourcePlaylistEntry => ({ path, separator: false, meta: {} })

  it('puts one separator between blocks and none at the ends, so the list shows where one set stops and the next starts', () => {
    expect(withBlockSeparators([[entry('/a'), entry('/b')], [entry('/c')], [entry('/d')]])).toEqual(
      [
        entry('/a'),
        entry('/b'),
        { path: null, separator: true, meta: {}, linkId: 'matching-sep-1' },
        entry('/c'),
        { path: null, separator: true, meta: {}, linkId: 'matching-sep-2' },
        entry('/d'),
      ],
    )
  })

  it('numbers each separator by the block it opens, even past a block that came back empty, so each row keeps its key', () => {
    const ids = withBlockSeparators([[], [entry('/a')], []]).flatMap((e) =>
      e.separator ? [e.linkId] : [],
    )
    expect(ids).toEqual(['matching-sep-1', 'matching-sep-2'])
  })
})
