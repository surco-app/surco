import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { nextWidth } from '../lib/resize'
import { Tooltip } from './Tooltip'

export function useResizableWidth(
  initial: number,
  min: number,
  max: number,
  // Fired once per finished gesture (drag release, auto-fit) with the final
  // width — the persistence hook, so a caller can save without being spammed
  // by the per-frame updates a drag produces.
  onCommit?: (width: number) => void,
): {
  width: number
  onPointerDown: (e: React.PointerEvent) => void
  // Resizes the panel by `deficit` px (the content overflow/slack from contentDeficit),
  // clamped to [min, max] — the double-click-to-fit gesture. A zero deficit is a no-op.
  autoFit: (deficit: number) => void
  // Parks the panel at an absolute width (clamped to [min, max]) WITHOUT committing — for
  // syncing to a width set elsewhere (a focus preset writes settings; the panel mirrors
  // it here), where re-committing would loop. A no-op when already at that width.
  syncTo: (width: number) => void
} {
  const [width, setWidth] = useState(initial)
  // Refs so the drag's window listeners and the memoized autoFit read the
  // latest values without re-subscribing.
  const widthRef = useRef(width)
  widthRef.current = width
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit
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
      const final = nextWidth(startWidth, latestX - startX, min, max)
      if (final !== startWidth) onCommitRef.current?.(final)
    }
    endDrag.current = cleanup
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
  }

  const autoFit = useCallback(
    (deficit: number): void => {
      if (deficit === 0) return
      const next = nextWidth(widthRef.current, deficit, min, max)
      setWidth(next)
      if (next !== widthRef.current) onCommitRef.current?.(next)
    },
    [min, max],
  )

  const syncTo = useCallback(
    (target: number): void => {
      const next = Math.min(max, Math.max(min, target))
      if (next !== widthRef.current) setWidth(next)
    },
    [min, max],
  )

  return { width, onPointerDown, autoFit, syncTo }
}

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
