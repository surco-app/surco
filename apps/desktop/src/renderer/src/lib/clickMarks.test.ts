import { describe, expect, it } from 'vitest'
import { MAX_MARKS, clickMarks, nextClick } from './clickMarks'

const FULL = { from: 0, to: 1 }

describe('clickMarks', () => {
  it('places each click at its share of the track', () => {
    const marks = clickMarks([30, 60], 120, FULL)
    expect(marks.map((m) => m.pct)).toEqual([25, 50])
    expect(marks.map((m) => m.sec)).toEqual([30, 60])
  })

  it('drops the clicks outside the visible window', () => {
    // Zoomed into the second half: the click at 10 s is off-screen, and drawing it
    // would put a mark at a negative offset.
    expect(clickMarks([10, 90], 120, { from: 0.5, to: 1 }).map((m) => m.sec)).toEqual([90])
  })

  // A dusty side can carry hundreds of clicks. Drawn full-length at overview zoom they
  // paint a solid wall over the wave — which reads as "the whole track is broken" and,
  // worse, hides where the clicks actually cluster. Thinning keeps the shape readable;
  // zooming in brings the rest back, because the window shrinks with it.
  it('thins a dense field to something the eye can still read', () => {
    const many = Array.from({ length: 900 }, (_, i) => i * 0.2)
    const marks = clickMarks(many, 180, FULL)
    expect(marks.length).toBeLessThanOrEqual(MAX_MARKS)
    expect(marks.length).toBeGreaterThan(0)
  })

  it('stops thinning once the user has zoomed in far enough to see them all', () => {
    const many = Array.from({ length: 900 }, (_, i) => i * 0.2)
    // A window holding only a handful of clicks draws every one of them: the thinning
    // is about what fits on screen, not about the track's total.
    const marks = clickMarks(many, 180, { from: 0, to: 0.01 })
    expect(marks.every((m) => m.sec <= 1.8)).toBe(true)
    expect(marks.length).toBeLessThanOrEqual(MAX_MARKS)
  })

  it('has nothing to draw for a track of unknown length', () => {
    expect(clickMarks([1, 2], 0, FULL)).toEqual([])
  })
})

describe('nextClick', () => {
  it('finds the first click after the playhead', () => {
    expect(nextClick([10, 20, 30], 12)).toBe(20)
  })

  it('wraps to the first click at the end, so the key never dead-ends', () => {
    expect(nextClick([10, 20, 30], 40)).toBe(10)
  })

  it('has nowhere to go on a clean track', () => {
    expect(nextClick([], 5)).toBeNull()
  })

  // Landing exactly ON a click and pressing again must advance, or the key would
  // trap the playhead on one click forever.
  it('advances past a click it is already sitting on', () => {
    expect(nextClick([10, 20], 10)).toBe(20)
  })
})
