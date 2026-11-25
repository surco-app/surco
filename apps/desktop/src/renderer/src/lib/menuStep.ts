export function menuStep(key: string, current: number, count: number): number | null {
  if (key === 'ArrowDown') return current < count - 1 ? current + 1 : 0
  if (key === 'ArrowUp') return current > 0 ? current - 1 : count - 1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}

// The stops the arrows walk. A disabled item is never one, whether a native control
// disabled with the attribute or an ARIA option with aria-disabled: Enter does nothing
// there, so parking on it reads as a menu that stopped answering.
export function menuItems(container: HTMLElement | null, selector: string): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(selector) ?? []).filter(
    (el) => !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true',
  )
}
