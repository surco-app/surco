import { describe, expect, it } from 'vitest'
import { matchingChains } from './matchingChains'

const byId = (id: string): string => id

describe('matchingChains', () => {
  it('joins pairs that share a track, so A–B and B–C read as one A, B, C chain', () => {
    expect(
      matchingChains(
        [
          ['a', 'b'],
          ['b', 'c'],
        ],
        byId,
      ),
    ).toEqual([['a', 'b', 'c']])
  })

  it('walks a chain from an end, because rekordbox stores each pair in deck order and not as a path', () => {
    expect(
      matchingChains(
        [
          ['a', 'm'],
          ['a', 'z'],
        ],
        byId,
      ),
    ).toEqual([['m', 'a', 'z']])
  })

  it('keeps unrelated pairs apart so each chain is a set the DJ can play straight through', () => {
    expect(
      matchingChains(
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

  it('lists a track once even when it has several partners', () => {
    expect(
      matchingChains(
        [
          ['hub', 'a'],
          ['hub', 'b'],
          ['hub', 'c'],
        ],
        byId,
      ),
    ).toEqual([['a', 'hub', 'b', 'c']])
  })

  it('collapses a pair rekordbox holds in both deck orders into one link', () => {
    expect(
      matchingChains(
        [
          ['a', 'b'],
          ['b', 'a'],
        ],
        byId,
      ),
    ).toEqual([['a', 'b']])
  })

  it('breaks ties by the label so the list does not reshuffle between reads', () => {
    const titles: Record<string, string> = { '9': 'Acid Groove', '1': 'Take Me Home' }
    expect(matchingChains([['1', '9']], (id) => titles[id])).toEqual([['9', '1']])
  })

  it('puts longer chains first so the richest runs are on top', () => {
    expect(
      matchingChains(
        [
          ['a', 'b'],
          ['x', 'y'],
          ['y', 'z'],
        ],
        byId,
      ),
    ).toEqual([
      ['x', 'y', 'z'],
      ['a', 'b'],
    ])
  })

  it('ignores a pair of a track with itself', () => {
    expect(matchingChains([['a', 'a']], byId)).toEqual([])
  })
})
