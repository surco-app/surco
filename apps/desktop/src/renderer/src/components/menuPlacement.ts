import type React from 'react'
import { useEffect } from 'react'

// Breathing room between the trigger and its menu, and the height below which dropping
// down is not worth it and the menu flips above instead.
const GAP = 4
const MIN_MENU_HEIGHT = 160
// What a capped menu keeps clear of the window edge it grows toward, so its last row and
// border read as a menu that scrolls instead of one cut off by the edge.
const EDGE = 8

export interface MenuPlacement {
  top?: number
  bottom?: number
  left?: number
  right?: number
  minWidth: number
  maxHeight: number
}

// Where a fixed, body-portaled menu sits, measured from its trigger when it opens. It
// anchors by `top` when it drops below the trigger and by `bottom` when it flips above, so
// the menu grows away from the viewport edge either way. A fixed menu near the bottom of
// the window would run past the edge where scrolling cannot reach it: it flips above the
// trigger when there is more room up there, and is capped to the room it has. An 'end'
// menu lines its right edge up with the trigger's, for a trigger at the end of a row.
export function placeMenu(r: DOMRect, align: 'start' | 'end' = 'start'): MenuPlacement {
  const below = window.innerHeight - r.bottom - GAP - EDGE
  const above = r.top - GAP - EDGE
  const flip = below < MIN_MENU_HEIGHT && above > below
  return {
    top: flip ? undefined : r.bottom + GAP,
    bottom: flip ? window.innerHeight - r.top + GAP : undefined,
    left: align === 'start' ? r.left : undefined,
    right: align === 'end' ? window.innerWidth - r.right : undefined,
    minWidth: r.width,
    maxHeight: Math.max(flip ? above : below, MIN_MENU_HEIGHT),
  }
}

// A placed menu is measured once, at open. Anything that moves the trigger afterwards
// would strand it away from what it points at, so close instead of chasing the trigger
// every frame — the same thing a native select does. The scroll is caught on the way down,
// so the editor's own scrolling column counts, not just the window; the menu's own list
// scrolling moves nothing it points at.
export function useCloseOnMove(
  active: boolean,
  menuRef: React.RefObject<HTMLElement | null>,
  setOpen: (open: boolean) => void,
): void {
  useEffect(() => {
    if (!active) return
    const dismiss = (e: Event): void => {
      if (e.target instanceof Node && menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', dismiss, true)
    return () => {
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', dismiss, true)
    }
  }, [active, menuRef, setOpen])
}
