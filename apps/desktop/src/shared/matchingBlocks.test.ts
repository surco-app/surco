import { describe, expect, it } from 'vitest'
import { matchingBlocks } from './matchingBlocks'

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
