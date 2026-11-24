// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { keepInWindow, menuOrigin, placeMenu } from './menuPlacement'

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

// A menu that grows from a point where its button is not reads as detached from what opened
// it, so the entrance starts at the button, in the menu's own coordinates.
describe('menuOrigin', () => {
  const trigger = { top: 100, bottom: 132, left: 380, right: 412, width: 32, height: 32 } as DOMRect

  it('grows a slid menu from the button centre, not from the menu corner', () => {
    window.innerWidth = 1360
    window.innerHeight = 844
    const slid = keepInWindow(placeMenu(trigger, 'end'), 460)
    expect(menuOrigin(slid, 460)).toBe('388px 0')
  })

  it('starts an unmoved end menu at the button centre, near its own right corner', () => {
    window.innerWidth = 1360
    const placed = placeMenu({ ...trigger, left: 1300, right: 1332 } as DOMRect, 'end')
    expect(menuOrigin(placed, 300)).toBe('284px 0')
  })

  it('starts a menu opened upward at its bottom edge', () => {
    window.innerWidth = 1360
    window.innerHeight = 650
    const placed = placeMenu({ ...trigger, top: 600, bottom: 632 } as DOMRect, 'start')
    expect(placed.bottom).toBeDefined()
    expect(menuOrigin(placed, 288)).toBe('16px 100%')
  })

  it('has no origin to compute without the button position', () => {
    expect(menuOrigin({ top: 0, left: 0, minWidth: 0, maxHeight: 200 }, 100)).toBeUndefined()
  })
})
