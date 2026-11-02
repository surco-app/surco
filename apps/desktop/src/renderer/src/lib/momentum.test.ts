import { describe, expect, it } from 'vitest'
import { coastDistance, releaseVelocity } from './momentum'

describe('releaseVelocity', () => {
  it('reads the speed of the last stretch of the drag, in px per ms', () => {
    const trail = [
      { at: 0, t: 0 },
      { at: 40, t: 16 },
      { at: 80, t: 32 },
    ]
    expect(releaseVelocity(trail, 32)).toBeCloseTo(2.5)
  })

  // A hand that stopped and then let go meant to leave the view where it is.
  it('is zero when the hand held still before letting go', () => {
    const trail = [
      { at: 0, t: 0 },
      { at: 80, t: 32 },
    ]
    expect(releaseVelocity(trail, 200)).toBe(0)
  })

  // Only the end of the gesture says where it was going; a slow start must not water down a flick.
  it('ignores the part of the drag older than the release window', () => {
    const trail = [
      { at: 0, t: 0 },
      { at: 10, t: 300 },
      { at: 50, t: 316 },
      { at: 90, t: 332 },
    ]
    expect(releaseVelocity(trail, 332)).toBeCloseTo(2.5)
  })

  // Two events in the same instant say nothing about speed; dividing by ~0 would throw the view.
  it('is zero when the drag is too short in time to measure', () => {
    const trail = [
      { at: 0, t: 0 },
      { at: 800, t: 1 },
    ]
    expect(releaseVelocity(trail, 1)).toBe(0)
  })
})

describe('coastDistance', () => {
  // Apple's scroll deceleration: the distance a flick travels before it comes to rest.
  it('projects a flick the way a scroll view decelerates', () => {
    expect(coastDistance(1)).toBeCloseTo(499, 0)
    expect(coastDistance(-2)).toBeCloseTo(-998, 0)
  })
})
