import { describe, expect, it } from 'vitest'
import { contentDeficit, nextWidth } from './resize'

describe('nextWidth', () => {
  it('adds the drag delta to the width the user started from', () => {
    expect(nextWidth(300, 40, 200, 480)).toBe(340)
    expect(nextWidth(300, -40, 200, 480)).toBe(260)
  })

  it('clamps to the minimum so a panel can never collapse out of reach', () => {
    expect(nextWidth(300, -500, 200, 480)).toBe(200)
  })

  it('clamps to the maximum so a panel can never swallow the rest of the window', () => {
    expect(nextWidth(300, 500, 200, 480)).toBe(480)
  })
})

describe('contentDeficit', () => {
  // Double-click-to-fit measures every truncating row as scrollWidth − clientWidth: how
  // many pixels it's clipped by (positive) or has to spare (negative). Feeding the max of
  // those into nextWidth sizes the column to the widest row, growing or shrinking to fit.
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
