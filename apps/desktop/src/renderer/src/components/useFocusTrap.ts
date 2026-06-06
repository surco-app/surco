import type React from 'react'
import { useEffect } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Keeps Tab focus inside an open dialog and returns focus to whatever was focused
// before it opened. Without this, Tab walks straight out to the controls behind
// the backdrop and the trigger loses focus when the dialog closes — both standard
// modal accessibility expectations.
export function useFocusTrap(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE))

    // Pull focus in if it isn't already inside, so the first Tab/Shift+Tab has a
    // known anchor. Components that focus their own input (e.g. the palette) keep
    // it, because focus is then already inside.
    if (!node.contains(document.activeElement)) focusables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent): void {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    node.addEventListener('keydown', onKeyDown)
    return () => {
      node.removeEventListener('keydown', onKeyDown)
      previouslyFocused?.focus?.()
    }
  }, [ref])
}
