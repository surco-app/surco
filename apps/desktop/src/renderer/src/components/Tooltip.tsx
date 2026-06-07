import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

// Themed hover tooltip, dropped in as a child of the trigger element. It follows the cursor
// (like a native title, but styled) and renders into a body-level portal so it never gets
// clipped by a scrolling panel and never looks detached from where the pointer actually is.
// Colours come from theme tokens on :root, which the portal inherits, so it tracks the
// light/dark theme automatically. `align`/`scope` are accepted for call-site compatibility
// but no longer affect placement now that the tooltip is cursor-anchored.
const WIDTH = 240
const MARGIN = 8
const OFFSET = 16

export function Tooltip({
  label,
}: {
  label: string
  align?: 'center' | 'start' | 'end'
  scope?: 'default' | 'cover' | 'dot'
}): React.JSX.Element {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const trigger = markerRef.current?.parentElement
    if (!trigger) return
    const onMove = (e: PointerEvent): void => {
      // Anchor below-right of the cursor, but flip/clamp near the viewport edges so a long
      // label never spills off-screen.
      const x = Math.min(Math.max(MARGIN, e.clientX + OFFSET), window.innerWidth - WIDTH - MARGIN)
      const y = Math.min(e.clientY + OFFSET, window.innerHeight - 48)
      setPos({ x, y })
    }
    const onLeave = (): void => setPos(null)
    trigger.addEventListener('pointermove', onMove)
    trigger.addEventListener('pointerleave', onLeave)
    trigger.addEventListener('pointerdown', onLeave)
    return () => {
      trigger.removeEventListener('pointermove', onMove)
      trigger.removeEventListener('pointerleave', onLeave)
      trigger.removeEventListener('pointerdown', onLeave)
    }
  }, [])

  return (
    <span ref={markerRef} className="hidden" aria-hidden="true">
      {pos &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: pos.x, top: pos.y, maxWidth: WIDTH }}
            className="animate-overlay pointer-events-none fixed z-50 w-max rounded-md bg-[var(--color-panel-2)] px-2 py-1 text-left text-xs font-normal text-fg shadow-md ring-1 ring-[var(--color-line-strong)]"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
