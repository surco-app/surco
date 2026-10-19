import { describe, expect, it } from 'vitest'
import { cueLetter } from './rowCues'

describe('cueLetter', () => {
  it('names hot cues as rekordbox shows them, skipping the kind it never uses', () => {
    expect([1, 2, 3, 5, 6, 7, 8, 9].map(cueLetter).join('')).toBe('ABCDEFGH')
  })

  it('gives no letter to a kind that is not a hot cue', () => {
    expect(cueLetter(0)).toBe('')
    expect(cueLetter(4)).toBe('')
  })
})
