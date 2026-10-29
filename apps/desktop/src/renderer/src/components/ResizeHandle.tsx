import type React from 'react'
import { useEffect, useState } from 'react'
import { Tooltip } from './Tooltip'

export function ResizeHandle({
  onPointerDown,
  onDoubleClick,
  title,
}: {
  onPointerDown: (e: React.PointerEvent) => void
  // Double-clicking the divider auto-fits the panel to its content (the Finder/Excel
  // gesture); omitted on panels that have nothing to measure.
  onDoubleClick?: () => void
  title?: string
}): React.JSX.Element {
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (!resizing) return
    const end = (): void => setResizing(false)
    window.addEventListener('pointerup', end)
    return () => window.removeEventListener('pointerup', end)
  }, [resizing])
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
      onPointerDown={(e) => {
        setResizing(true)
        onPointerDown(e)
      }}
      onDoubleClick={onDoubleClick}
      className="relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--color-line)] transition-colors hover:bg-[var(--color-accent)]"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      {title && !resizing && <Tooltip label={title} />}
    </div>
  )
}
