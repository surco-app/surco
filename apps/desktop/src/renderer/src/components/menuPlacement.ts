import type React from 'react'
import { useEffect, useLayoutEffect } from 'react'

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
  anchorX?: number
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
    anchorX: r.left + r.width / 2,
  }
}

// The menu's width is only known once it is mounted, so placeMenu cannot keep it inside
// the window by itself: an 'end' menu wider than the room left of its trigger would start
// below x=0 and lose its icons to the edge. This slides it sideways by just what it
// overflows, keeping the same breathing room as the vertical edges, and never cuts it.
export function keepInWindow(p: MenuPlacement, width: number): MenuPlacement {
  const room = window.innerWidth - width - EDGE
  const clampSide = (side: number | undefined): number | undefined =>
    side === undefined ? undefined : Math.max(EDGE, Math.min(side, room))
  const left = clampSide(p.left)
  const right = clampSide(p.right)
  return left === p.left && right === p.right ? p : { ...p, left, right }
}

// Where a menu's entrance should grow from: the trigger's horizontal centre, in the menu's
// own coordinates, on the edge facing the trigger. A class origin pins to the menu's corner,
// which is no longer where the trigger is once keepInWindow slid the menu sideways.
export function menuOrigin(p: MenuPlacement, width: number): string | undefined {
  if (p.anchorX === undefined) return undefined
  const left = p.left ?? window.innerWidth - (p.right ?? 0) - width
  return `${p.anchorX - left}px ${p.bottom !== undefined ? '100%' : '0'}`
}

export function useKeepInWindow(
  open: boolean,
  pos: MenuPlacement | null,
  menuRef: React.RefObject<HTMLElement | null>,
  setPos: (pos: MenuPlacement) => void,
): void {
  useLayoutEffect(() => {
    if (!open || !pos || !menuRef.current) return
    const width = menuRef.current.offsetWidth
    const fitted = keepInWindow(pos, width)
    if (fitted !== pos) {
      setPos(fitted)
      return
    }
    const origin = menuOrigin(pos, width)
    if (origin) menuRef.current.style.transformOrigin = origin
  }, [open, pos, menuRef, setPos])
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
