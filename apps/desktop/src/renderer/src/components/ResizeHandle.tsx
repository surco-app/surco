import type React from 'react'
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
      onDoubleClick={onDoubleClick}
      className="relative z-10 w-px shrink-0 cursor-col-resize bg-[var(--color-line)] transition-colors hover:bg-[var(--color-accent)]"
    >
      <div className="absolute inset-y-0 -left-1 -right-1" />
      {title && <Tooltip label={title} />}
    </div>
  )
}
