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
const OFFSET = 14

export function Tooltip({
  label,
}: {
  label: string
  align?: 'center' | 'start' | 'end'
  scope?: 'default' | 'cover' | 'dot'
}): React.JSX.Element {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; transform: string } | null>(null)

  useEffect(() => {
    const trigger = markerRef.current?.parentElement
    if (!trigger) return
    const onMove = (e: PointerEvent): void => {
      // Hug the cursor on whichever side has room: near the right/bottom edges the tooltip
      // flips via a transform so it stays next to the pointer instead of clamping far away.
      const flipX = e.clientX + OFFSET + WIDTH > window.innerWidth
      const flipY = e.clientY + OFFSET + 56 > window.innerHeight
      setPos({
        left: flipX ? e.clientX - OFFSET : e.clientX + OFFSET,
        top: flipY ? e.clientY - OFFSET : e.clientY + OFFSET,
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
      })
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
            style={{ left: pos.left, top: pos.top, transform: pos.transform, maxWidth: WIDTH }}
            className="animate-overlay pointer-events-none fixed z-50 w-max rounded-md bg-[var(--color-panel-2)] px-2 py-1 text-left text-xs font-normal text-fg shadow-md ring-1 ring-[var(--color-line-strong)]"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
