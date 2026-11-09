import { describe, expect, it } from 'vitest'
import { mineCombos } from './sessionCombos'

const pool = (...ids: string[]): ReadonlySet<string> => new Set(ids)

describe('mineCombos', () => {
  it('adds one to a pair for every Set playlist it appears in', () => {
    const combos = mineCombos(
      [
        ['a', 'b'],
        ['x', 'a', 'b'],
      ],
      pool('a', 'b', 'x'),
    )
    expect(combos.get('a')?.get('b')).toBe(2)
  })

  it('counts a pair once per playlist even when the playlist repeats it', () => {
    const combos = mineCombos([['a', 'b', 'a', 'b']], pool('a', 'b'))
    expect(combos.get('a')?.get('b')).toBe(1)
  })

  it('keeps the direction, so b then a is not implied by a then b', () => {
    const combos = mineCombos([['a', 'b']], pool('a', 'b'))
    expect(combos.get('b')?.get('a')).toBeUndefined()
  })

  it('ignores a pair when either track is outside the pool', () => {
    const combos = mineCombos([['a', 'gone', 'b']], pool('a', 'b'))
    expect(combos.size).toBe(0)
  })

  it('does not break on an empty playlist or one with a single track', () => {
    expect(mineCombos([[], ['a']], pool('a')).size).toBe(0)
  })

  it('ignores a track followed by itself', () => {
    expect(mineCombos([['a', 'a']], pool('a')).size).toBe(0)
  })

  it('turns a run of three into two linked pairs of strength one', () => {
    const combos = mineCombos([['a', 'b', 'c']], pool('a', 'b', 'c'))
    expect(combos.get('a')?.get('b')).toBe(1)
    expect(combos.get('b')?.get('c')).toBe(1)
  })

  it('finds the Absolom, The Bass, Crush chain from a Set that holds it', () => {
    const combos = mineCombos(
      [['x', 'absolom-secret', 'the-bass-here-we-go', 'crush-jellyhead', 'y']],
      pool('absolom-secret', 'the-bass-here-we-go', 'crush-jellyhead'),
    )
    expect(combos.get('absolom-secret')?.get('the-bass-here-we-go')).toBe(1)
    expect(combos.get('the-bass-here-we-go')?.get('crush-jellyhead')).toBe(1)
  })
})
