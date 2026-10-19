import { describe, expect, it } from 'vitest'
import { contentDeficit } from './resize'

describe('contentDeficit', () => {
  // Double-click-to-fit measures every truncating row as scrollWidth − clientWidth: how
  // many pixels it's clipped by (positive) or has to spare (negative). Feeding the max of
  // those into the column layout sizes the column to the widest row, growing or shrinking to fit.
  it('returns how much the most-clipped row overflows so the column grows to it', () => {
    const rows = [
      { scrollWidth: 240, clientWidth: 200 }, // clipped by 40
      { scrollWidth: 210, clientWidth: 200 }, // clipped by 10
    ]
    expect(contentDeficit(rows)).toBe(40)
  })

  it('returns the slack of the widest row (negative) so a roomy column shrinks to fit', () => {
    const rows = [
      { scrollWidth: 150, clientWidth: 200 }, // 50 to spare
      { scrollWidth: 180, clientWidth: 200 }, // only 20 to spare — the binding row
    ]
    expect(contentDeficit(rows)).toBe(-20)
  })

  it('is zero when there is nothing to measure, leaving the width untouched', () => {
    expect(contentDeficit([])).toBe(0)
  })
})
