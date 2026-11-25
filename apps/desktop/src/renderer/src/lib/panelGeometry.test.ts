import { describe, expect, it } from 'vitest'
import {
  clampPanelGeometry,
  DEFAULT_GEOMETRY,
  MIN_HEIGHT,
  MIN_WIDTH,
  PANEL_MARGIN,
} from './panelGeometry'

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

// A panel that appears far from the button that opened it does not read as that button's
// panel; with nothing saved it hangs from the button instead of a fixed corner.
describe('clampPanelGeometry with nothing saved and a button to hang from', () => {
  const button = { right: 1420, bottom: 44 }

  it('lines its right edge up with the button, below it, at 440 wide', () => {
    const g = clampPanelGeometry(null, viewport, button)
    expect(g.size.width).toBe(440)
    expect(g.pos.x + g.size.width).toBe(button.right)
    expect(g.pos.y).toBeGreaterThan(button.bottom)
  })

  it('keeps the right margin when the button sits closer to the edge than that', () => {
    const g = clampPanelGeometry(null, viewport, { right: 1438, bottom: 44 })
    expect(g.pos.x + g.size.width).toBe(viewport.width - PANEL_MARGIN)
  })

  it('stays inside a narrow window with its margin on both sides', () => {
    const g = clampPanelGeometry(null, { width: 300, height: 900 }, { right: 290, bottom: 44 })
    expect(g.pos.x).toBeGreaterThanOrEqual(PANEL_MARGIN)
    expect(g.pos.x + g.size.width).toBeLessThanOrEqual(300 - PANEL_MARGIN)
    expect(g.size.width).toBeGreaterThanOrEqual(MIN_WIDTH)
  })

  it('stays above the bottom edge of a short window', () => {
    const g = clampPanelGeometry(null, { width: 1440, height: 300 }, button)
    expect(g.pos.y + g.size.height).toBeLessThanOrEqual(300 - PANEL_MARGIN)
    expect(g.size.height).toBeGreaterThanOrEqual(MIN_HEIGHT)
  })

  it('still restores a saved geometry untouched by the button', () => {
    expect(
      clampPanelGeometry({ x: 100, y: 200, width: 400, height: 500 }, viewport, button),
    ).toEqual({
      pos: { x: 100, y: 200 },
      size: { width: 400, height: 500 },
    })
  })
})
