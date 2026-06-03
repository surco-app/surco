import { describe, expect, it } from 'vitest'
import { insertToken } from './insertToken'

describe('insertToken', () => {
  // Clicking a chip drops the {token} where the caret sits, so the user keeps
  // typing right after it.
  it('inserts the braced token at a collapsed caret', () => {
    expect(insertToken('a - b', 4, 4, 'title')).toEqual({ value: 'a - {title}b', caret: 11 })
  })

  it('appends at the end of the string', () => {
    expect(insertToken('{artist} - ', 11, 11, 'title')).toEqual({
      value: '{artist} - {title}',
      caret: 18,
    })
  })

  it('inserts at the very start', () => {
    expect(insertToken('rest', 0, 0, 'year')).toEqual({ value: '{year}rest', caret: 6 })
  })

  // A selection is replaced, so re-picking a token swaps it out instead of piling on.
  it('replaces the current selection', () => {
    expect(insertToken('{artist} - x', 11, 12, 'title')).toEqual({
      value: '{artist} - {title}',
      caret: 18,
    })
  })
})
