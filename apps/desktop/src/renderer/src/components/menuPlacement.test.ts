// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { placeMenu } from './menuPlacement'

// A placed menu capped exactly to the window's edge ran its last row and its bottom border
// into it, so it read as cut off rather than as a menu that scrolls.
describe('placeMenu', () => {
  const at = (top: number, bottom: number) =>
    ({ top, bottom, left: 0, right: 200, width: 200, height: bottom - top }) as DOMRect

  it('leaves room between a dropped menu and the window floor', () => {
    window.innerHeight = 650
    const p = placeMenu(at(152, 186))
    expect((p.top ?? 0) + p.maxHeight).toBeLessThanOrEqual(650 - 8)
  })

  it('leaves room between a flipped menu and the window top', () => {
    window.innerHeight = 650
    const p = placeMenu(at(600, 632))
    expect(650 - (p.bottom ?? 0) - p.maxHeight).toBeGreaterThanOrEqual(8)
  })
})
