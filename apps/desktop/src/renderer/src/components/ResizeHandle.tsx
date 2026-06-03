import type React from 'react'
import { useState } from 'react'
import { nextWidth } from '../lib/resize'

export function useResizableWidth(
  initial: number,
  min: number,
  max: number,
): { width: number; onPointerDown: (e: React.PointerEvent) => void } {
  const [width, setWidth] = useState(initial)

  function onPointerDown(e: React.PointerEvent): void {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    function onMove(ev: PointerEvent): void {
      setWidth(nextWidth(startWidth, ev.clientX - startX, min, max))
    }
    function onUp(): void {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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
