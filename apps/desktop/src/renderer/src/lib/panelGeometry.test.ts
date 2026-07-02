import { describe, expect, it } from 'vitest'
import { clampPanelGeometry, DEFAULT_GEOMETRY, MIN_HEIGHT, MIN_WIDTH } from './panelGeometry'

const viewport = { width: 1440, height: 900 }

describe('clampPanelGeometry', () => {
  // The whole point of persisting: the card reopens where the user left it.
  it('restores a saved position and size', () => {
    expect(clampPanelGeometry({ x: 100, y: 200, width: 400, height: 500 }, viewport)).toEqual({
      pos: { x: 100, y: 200 },
      size: { width: 400, height: 500 },
    })
  })

  // First run (null) or a hand-edited settings file must degrade to the default
  // corner rather than render the card at NaN.
  it('defaults on a missing or malformed value', () => {
    expect(clampPanelGeometry(null, viewport)).toEqual(DEFAULT_GEOMETRY)
    expect(clampPanelGeometry(undefined, viewport)).toEqual(DEFAULT_GEOMETRY)
    expect(
      clampPanelGeometry({ x: Number('left'), y: 0, width: 320, height: 360 }, viewport),
    ).toEqual(DEFAULT_GEOMETRY)
  })

  // The window may be smaller than when the position was saved (external screen
  // unplugged): a card restored beyond the viewport could never be grabbed back.
  it('clamps a saved position back into the viewport', () => {
    const g = clampPanelGeometry({ x: 5000, y: -50, width: 320, height: 360 }, viewport)
    expect(g.pos.x).toBe(viewport.width - 120)
    expect(g.pos.y).toBe(0)
  })

  // A saved size below the floors would collide the header controls, same as a live resize.
  it('floors a saved size at the minimums', () => {
    const g = clampPanelGeometry({ x: 0, y: 0, width: 10, height: 10 }, viewport)
    expect(g.size).toEqual({ width: MIN_WIDTH, height: MIN_HEIGHT })
  })
})
