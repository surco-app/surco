import type React from 'react'

export function menuStep(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return current < count - 1 ? current + 1 : 0
  if (key === 'ArrowUp') return current > 0 ? current - 1 : count - 1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

// The stops the arrows walk. A disabled item is one too, as in a macOS menu: the keyboard
// user finds it and reads why it is off instead of the arrows jumping over it. That is why
// menu items are disabled with aria-disabled, since a disabled button takes no focus.
export function menuItems(container: HTMLElement | null, selector: string): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(selector) ?? [])
}

// Set on a menu as its click capture: a click on an aria-disabled item, or Enter or Space
// that the browser turns into one, stops here before the item's own handler runs.
export function ignoreDisabledClick(e: React.MouseEvent<HTMLElement>): void {
  if (!(e.target instanceof Element) || !e.target.closest('[aria-disabled="true"]')) return
  e.preventDefault()
  e.stopPropagation()
}
