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
// A short pause before a hover tooltip appears, so it never flickers up while the
// pointer is just passing over a control — the same restraint as a native macOS help
// tag. Keyboard focus still surfaces it at once, where the wait would only get in the way.
const HOVER_DELAY = 400

export function Tooltip({
  label,
  hoverOnly = false,
  stopPropagation = false,
}: {
  label: string
  align?: 'center' | 'start' | 'end'
  scope?: 'default' | 'cover' | 'dot'
  // For an editable trigger (a metadata input): the focus reveal would pop the value
  // tooltip over the text the user is about to type, so opt out of it and stay a pure
  // hover hint. Hover (and Escape-to-dismiss) still work as usual.
  hoverOnly?: boolean
  // For a tooltip nested inside another tooltip's trigger (e.g. a title inside a button
  // that has its own hint): stop the pointer move from bubbling to the outer trigger so
  // only this tooltip arms while the pointer is over the inner element, letting it take
  // over from the outer hint right there.
  stopPropagation?: boolean
}): React.JSX.Element {
  const markerRef = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; transform: string } | null>(null)

  useEffect(() => {
    const trigger = markerRef.current?.parentElement
    if (!trigger) return
    // Hug the given point on whichever side has room: near the right/bottom edges the
    // tooltip flips via a transform so it stays next to the anchor instead of clamping.
    const showAt = (x: number, y: number): void => {
      const flipX = x + OFFSET + WIDTH > window.innerWidth
      const flipY = y + OFFSET + 56 > window.innerHeight
      setPos({
        left: flipX ? x - OFFSET : x + OFFSET,
        top: flipY ? y - OFFSET : y + OFFSET,
        transform: `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})`,
      })
    }
    // Once the tooltip is up it tracks the cursor live; before that, the first moves
    // only arm a timer, so a quick pass-through never flashes it. last holds the latest
    // point for the timer to read, so the tooltip opens where the cursor actually is.
    let shown = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const last = { x: 0, y: 0 }
    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onMove = (e: PointerEvent): void => {
      // Keep the move from reaching an outer trigger that has its own tooltip, so a
      // nested tooltip supersedes the outer hint instead of both arming together.
      if (stopPropagation) e.stopPropagation()
      last.x = e.clientX
      last.y = e.clientY
      if (shown) {
        showAt(e.clientX, e.clientY)
        return
      }
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          shown = true
          showAt(last.x, last.y)
        }, HOVER_DELAY)
      }
    }
    const onLeave = (): void => {
      clearTimer()
      shown = false
      setPos(null)
    }
    // Keyboard users get the same hint: with no cursor to follow, anchor it to the
    // trigger's box, and let Escape dismiss it without moving focus (WCAG 1.4.13). Focus
    // skips the hover delay — the wait only earns its keep against an idle pointer.
    const onFocus = (): void => {
      clearTimer()
      shown = true
      const r = trigger.getBoundingClientRect()
      showAt(r.left + r.width / 2, r.bottom)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onLeave()
    }
    trigger.addEventListener('pointermove', onMove)
    trigger.addEventListener('pointerleave', onLeave)
    trigger.addEventListener('pointerdown', onLeave)
    trigger.addEventListener('keydown', onKeyDown)
    // An editable trigger opts out of the focus reveal (it would cover the text being
    // typed); the pointer listeners above still give it a normal hover hint.
    if (!hoverOnly) {
      trigger.addEventListener('focusin', onFocus)
      trigger.addEventListener('focusout', onLeave)
    }
    return () => {
      trigger.removeEventListener('pointermove', onMove)
      trigger.removeEventListener('pointerleave', onLeave)
      trigger.removeEventListener('pointerdown', onLeave)
      trigger.removeEventListener('keydown', onKeyDown)
      trigger.removeEventListener('focusin', onFocus)
      trigger.removeEventListener('focusout', onLeave)
      clearTimer()
    }
  }, [hoverOnly, stopPropagation])

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
