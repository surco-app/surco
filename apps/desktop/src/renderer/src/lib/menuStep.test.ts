// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { menuItems, menuStep } from './menuStep'

describe('menuStep', () => {
  // A menu has no dead end: the arrows wrap like a native macOS menu, so a long press
  // keeps cycling instead of sticking on the last item.
  it('wraps from the last item to the first and back', () => {
    expect(menuStep('ArrowDown', 2, 3)).toBe(0)
    expect(menuStep('ArrowUp', 0, 3)).toBe(2)
  })

  it('moves one item at a time inside the menu', () => {
    expect(menuStep('ArrowDown', 0, 3)).toBe(1)
    expect(menuStep('ArrowUp', 2, 3)).toBe(1)
  })

  // Focus can sit outside the items (on the menu itself or a header): the first press
  // must still land on an item, the first going down and the last going up.
  it('enters the menu from outside the items', () => {
    expect(menuStep('ArrowDown', -1, 3)).toBe(0)
    expect(menuStep('ArrowUp', -1, 3)).toBe(2)
  })

  it('jumps to the ends with Home and End', () => {
    expect(menuStep('Home', 1, 3)).toBe(0)
    expect(menuStep('End', 1, 3)).toBe(2)
  })

  // Any other key is not a move, so each menu keeps deciding what it does with it
  // (Enter activates, letters stay out of the global shortcuts).
  it('answers null for a key that does not move', () => {
    expect(menuStep('Enter', 1, 3)).toBeNull()
    expect(menuStep('j', 1, 3)).toBeNull()
    expect(menuStep('ArrowRight', 1, 3)).toBeNull()
  })
})

describe('menuItems', () => {
  function menu(html: string): HTMLElement {
    const el = document.createElement('div')
    el.innerHTML = html
    return el
  }

  // An aria-disabled item stays a stop, like a macOS menu: the keyboard user finds it and
  // reads why it is off. A natively disabled button can take no focus in a browser, so
  // stopping on it would leave the arrows stuck: those are left out.
  it('keeps aria-disabled items as stops and skips natively disabled ones', () => {
    const el = menu(`
      <button role="option" data-testid="a"></button>
      <button role="option" data-testid="b" disabled></button>
      <button role="option" data-testid="c" aria-disabled="true"></button>
      <button role="option" data-testid="d" aria-disabled="false"></button>
    `)
    expect(menuItems(el, '[role="option"]').map((i) => i.dataset.testid)).toEqual(['a', 'c', 'd'])
  })

  it('keeps only what the selector picks, in document order', () => {
    const el = menu(`
      <button role="menuitem" data-testid="a"></button>
      <hr />
      <button data-testid="other"></button>
      <button role="menuitem" data-testid="b"></button>
    `)
    expect(menuItems(el, '[role="menuitem"]').map((i) => i.dataset.testid)).toEqual(['a', 'b'])
  })

  it('answers no items before the menu is mounted', () => {
    expect(menuItems(null, '[role="menuitem"]')).toEqual([])
  })
})
