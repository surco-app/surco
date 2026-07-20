import { describe, expect, it } from 'vitest'
import { hasMoreBelow } from './useScrollAffordance'

// The bottom fade answers one question — "is there content the user hasn't scrolled to
// yet?" — so the affordance shows only when scrolling would actually reveal something.
describe('hasMoreBelow', () => {
  it('is true when content overflows and the view sits at the top', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 280, scrollHeight: 600 })).toBe(true)
  })

  it('is false once scrolled to the very bottom, so the fade clears at the end', () => {
    expect(hasMoreBelow({ scrollTop: 320, clientHeight: 280, scrollHeight: 600 })).toBe(false)
  })

  it('is false when the content fits without scrolling, so a short tab shows no false signal', () => {
    expect(hasMoreBelow({ scrollTop: 0, clientHeight: 400, scrollHeight: 400 })).toBe(false)
  })

  // Sub-pixel layout leaves scrollTop + clientHeight a hair short of scrollHeight at the
  // real bottom; a 1px slack keeps the fade from lingering on the last line.
  it('treats a sub-pixel gap at the bottom as the bottom', () => {
    expect(hasMoreBelow({ scrollTop: 319.4, clientHeight: 280, scrollHeight: 600 })).toBe(false)
  })
})
