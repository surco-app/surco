import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { nextWidth } from '../lib/resize'

export function useResizableWidth(
  initial: number,
  min: number,
  max: number,
): { width: number; onPointerDown: (e: React.PointerEvent) => void } {
  const [width, setWidth] = useState(initial)
  // Holds the teardown for an in-flight drag so unmounting mid-drag doesn't leak
  // the window listeners or leave the body cursor stuck at col-resize.
  const endDrag = useRef<(() => void) | null>(null)
  useEffect(() => () => endDrag.current?.(), [])

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    // Coalesce moves to one state update per frame: pointermove fires far faster
    // than the screen repaints, and each setWidth re-renders the resized panel.
    let frame = 0
    let latestX = startX
    function onMove(ev: PointerEvent): void {
      latestX = ev.clientX
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setWidth(nextWidth(startWidth, latestX - startX, min, max))
      })
    }
    function cleanup(): void {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      document.body.style.cursor = ''
      endDrag.current = null
    }
    endDrag.current = cleanup
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  }

  return { width, onPointerDown }
}

export function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void
}): React.JSX.Element {
  return (
    // A pointer-only resize affordance: the panels are fully usable at their
    // default width, so by design it offers no keyboard interaction and none of
    // the focusable-splitter ARIA props apply.
    // biome-ignore lint/a11y/useFocusableInteractive: pointer-only, intentionally not focusable
    // biome-ignore lint/a11y/useSemanticElements: no semantic HTML element exists for a draggable splitter
    <div
      // biome-ignore lint/a11y/useAriaPropsForRole: not focusable, so splitter value props don't apply
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className="relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--color-line)] transition-colors hover:bg-[var(--color-accent)]"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
    </div>
  )
}
