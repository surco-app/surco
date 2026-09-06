import { describe, expect, it } from 'vitest'
import { contentDeficit, fitProbe, growToSpare, nextWidth } from './resize'

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

describe('fitProbe', () => {
  const el = (scrollWidth: number, clientWidth: number, inner: [number, number][] = []) => ({
    scrollWidth,
    clientWidth,
    querySelectorAll: () => inner.map(([s, c]) => ({ scrollWidth: s, clientWidth: c })),
  })

  // The bug this exists for: the [data-fit] marker is the row's flex cell, which never
  // overflows its own box, so a title cut off by 236px measured as 0 and the column never
  // grew. The ellipsis lives on a child, and that child is what has to be measured.
  it('measures the truncating child, not the cell that cannot overflow', () => {
    const probe = fitProbe(el(219, 219, [[455, 219]]))
    expect(probe.scrollWidth - probe.clientWidth).toBe(236)
  })

  it('takes the most-clipped child when a row stacks several', () => {
    const probe = fitProbe(el(200, 200, [[240, 200], [320, 200]]))
    expect(probe.scrollWidth - probe.clientWidth).toBe(120)
  })

  it('falls back to the marker itself when nothing inside truncates', () => {
    const probe = fitProbe(el(260, 200))
    expect(probe.scrollWidth - probe.clientWidth).toBe(60)
  })
})

describe('growToSpare', () => {
  // Widening the window used to hand every new pixel to the editor, because the two left
  // columns carry a fixed width and the editor is the flex child. Track and release names
  // stayed truncated in a window with room to spare. This shares the surplus out: a column
  // takes what its content is short by, but only out of space the editor doesn't need.
  it('gives a clipped column the room it is short by', () => {
    expect(growToSpare({ width: 300, deficit: 40, max: 600 }, 200)).toBe(340)
  })

  it('stops at the column maximum however much space is going spare', () => {
    expect(growToSpare({ width: 300, deficit: 900, max: 600 }, 900)).toBe(600)
  })

  // The editor's minimum is the whole point of "only if there is room to spare": a narrow
  // window leaves its columns as they are rather than squeezing the spectrum and the fields.
  it('never takes more than the spare width on offer', () => {
    expect(growToSpare({ width: 300, deficit: 200, max: 600 }, 50)).toBe(350)
  })

  it('leaves the column alone when there is no spare width', () => {
    expect(growToSpare({ width: 300, deficit: 200, max: 600 }, 0)).toBe(300)
  })

  // Only ever grows. Shrinking a column the user is looking at is a change they didn't ask
  // for, and narrowing the window already squeezes the editor on its own.
  it('never shrinks a column that has width to spare', () => {
    expect(growToSpare({ width: 400, deficit: -80, max: 600 }, 200)).toBe(400)
  })
})
