// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { keepInWindow, placeMenu } from './menuPlacement'

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

// An 'end' menu wider than the room left of its trigger started below x=0 and lost its
// icons to the window's edge; it has to slide back in instead of being cut.
describe('keepInWindow', () => {
  const trigger = { top: 100, bottom: 132, left: 380, right: 412, width: 32, height: 32 } as DOMRect

  it('slides an end menu wider than the room on its left back inside the window', () => {
    window.innerWidth = 1360
    window.innerHeight = 844
    const p = keepInWindow(placeMenu(trigger, 'end'), 460)
    expect(1360 - (p.right ?? 0) - 460).toBeGreaterThanOrEqual(8)
  })

  it('keeps an end menu that fits where the trigger puts it', () => {
    window.innerWidth = 1360
    const placed = placeMenu(trigger, 'end')
    expect(keepInWindow(placed, 300)).toEqual(placed)
  })

  it('slides a start menu wider than the room on its right back inside the window', () => {
    window.innerWidth = 500
    const near = { ...trigger, left: 460, right: 492 } as DOMRect
    const p = keepInWindow(placeMenu(near, 'start'), 288)
    expect((p.left ?? 0) + 288).toBeLessThanOrEqual(500 - 8)
  })

  it('keeps a start menu that fits where the trigger puts it', () => {
    window.innerWidth = 1360
    const placed = placeMenu(trigger, 'start')
    expect(keepInWindow(placed, 288)).toEqual(placed)
  })
})
