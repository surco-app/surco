import type React from 'react'
import { useEffect, useRef, useState } from 'react'

// The editor footer's split button, shared: a full-width accent body for the main action
// and a chevron that opens a menu of the others above it.

export const FOOTER_BAR =
  'border-t border-[var(--color-line)] bg-[var(--color-ink)] px-6 py-3.5 compact:py-2'
export const SPLIT_BODY =
  'press relative -mr-px flex-1 overflow-hidden rounded-l-lg bg-[var(--color-panel-2)] py-2.5 text-sm font-medium disabled:pointer-events-none disabled:opacity-40'
export const SPLIT_BODY_READY =
  'text-[var(--color-on-accent)] aria-disabled:pointer-events-none aria-disabled:opacity-40'
export const SPLIT_TOGGLE =
  'press relative flex w-10 items-center justify-center overflow-hidden rounded-r-lg before:absolute before:inset-y-2.5 before:left-0 before:z-10 before:w-px disabled:pointer-events-none'
// The box around the stacked format names, shared by every toggle that shows the format, so
// the dropdown keeps one width whichever face of the footer draws it. A border would widen
// it, so a toggle that needs an outline draws it as an inset ring.
export const FORMAT_TOGGLE_BOX = 'gap-1 px-3'
export const FORMAT_TOGGLE_BOX_NAME = 'format-toggle'
// The same toggle sized by the chosen format it shows instead of a fixed chevron width.
export const SPLIT_TOGGLE_FORMAT = `press relative flex items-center justify-center ${FORMAT_TOGGLE_BOX} overflow-hidden rounded-r-lg before:absolute before:inset-y-2.5 before:left-0 before:z-10 before:w-px disabled:pointer-events-none`
export const SPLIT_BODY_QUIET = 'text-fg-muted'
export const SPLIT_TOGGLE_QUIET =
  'bg-[var(--color-panel-2)] text-fg-faint before:bg-[var(--color-line-strong)]'
export const SPLIT_TOGGLE_DIMMED =
  'bg-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-ink))] text-[var(--color-on-accent)] before:bg-[var(--color-on-accent)]/20 hover:bg-[color-mix(in_srgb,var(--color-accent)_55%,var(--color-ink))]'
export const SPLIT_TOGGLE_READY =
  'bg-[var(--color-accent)] text-[var(--color-on-accent)] before:bg-[var(--color-on-accent)]/20 disabled:opacity-40'
export const SPLIT_MENU =
  'animate-pop-flat absolute right-0 bottom-full z-50 mb-2 w-56 origin-bottom-right overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]'
// The same menu hung under its chevron, for a split button that sits in a top bar.
export const SPLIT_MENU_DOWN =
  'animate-pop-flat absolute right-0 top-full z-50 mt-2 w-56 origin-top-right overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-panel-2)] py-1 shadow-[var(--shadow-float)]'
export const SPLIT_ITEM =
  'flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-[var(--color-panel)] focus-visible:bg-[var(--color-panel)] focus-visible:shadow-none'

// The menu's reachable items in order: a disabled pick (Apple Music under FLAC) can't take
// focus, so the arrows skip it rather than stall on it.
function menuItemsOf(menu: HTMLElement | null): HTMLElement[] {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])
}

export function useSplitMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (ref.current?.contains(target) || menuRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // The same keyboard contract as TrackContextMenu: opening lands focus on the checked
  // item, and closing hands it back to the chevron. Only when focus was left with nowhere
  // to go, though: a click outside that closed the menu keeps the focus it just set.
  useEffect(() => {
    if (!open) return
    const items = menuItemsOf(menuRef.current)
    ;(items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
    return () => {
      const at = document.activeElement
      if (!at || at === document.body) toggleRef.current?.focus()
    }
  }, [open])

  function onMenuKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      return
    }
    const items = menuItemsOf(menuRef.current)
    const idx = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = idx < items.length - 1 ? idx + 1 : 0
    else if (e.key === 'ArrowUp') next = idx > 0 ? idx - 1 : items.length - 1
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next === -1 || items.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    items[next].focus()
  }

  return { open, setOpen, ref, toggleRef, menuRef, onMenuKeyDown }
}
