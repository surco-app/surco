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
  hint,
  hoverOnly = false,
}: {
  label: string
  // An optional keyboard chord (e.g. "⌘O"), shown dimmed after the label so a control's
  // shortcut is discoverable on hover without a second visual style at every call site.
  hint?: string
  align?: 'center' | 'start' | 'end'
  scope?: 'default' | 'cover' | 'dot'
  // For an editable trigger (a metadata input): the focus reveal would pop the value
  // tooltip over the text the user is about to type, so opt out of it and stay a pure
  // hover hint. Hover (and Escape-to-dismiss) still work as usual.
  hoverOnly?: boolean
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
    let tracking = false
    const last = { x: 0, y: 0 }
    const clearTimer = (): void => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const onMove = (e: PointerEvent): void => {
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
    // The cursor-tracking listeners cost what they cost times every tooltip on screen, and
    // the track list carries seven per row. Bound up front they were ~42 idle listeners a
    // row — ~21,000 across a 500-track crate — to serve a pointer that is only ever over one
    // row at a time. So the resting cost is this single pointerenter, and the tracking is
    // bound on the row the cursor actually reaches, then unbound when it leaves.
    const stopTracking = (): void => {
      if (!tracking) return
      tracking = false
      trigger.removeEventListener('pointermove', onMove)
      trigger.removeEventListener('pointerleave', onLeave)
      trigger.removeEventListener('pointerdown', onLeave)
    }
    const onEnter = (e: PointerEvent): void => {
      if (!tracking) {
        tracking = true
        trigger.addEventListener('pointermove', onMove)
        trigger.addEventListener('pointerleave', onLeave)
        trigger.addEventListener('pointerdown', onLeave)
      }
      // Arm the delay from the entry point: a pointer that enters and holds perfectly still
      // fires no pointermove, and would otherwise never raise the tooltip at all.
      onMove(e)
    }
    const onLeave = (): void => {
      clearTimer()
      shown = false
      stopTracking()
      setPos(null)
    }
    // A click focuses the button it hit, which fires focusin just like a Tab would — but
    // the click's pointerdown already ran onLeave, so a plain focus reveal would re-open
    // the tooltip the click meant to dismiss and strand it over the control (djotas's
    // stuck "Regenerate filename" block). pointerdown lands right before that focusin, so
    // it flags the focus as mouse-originated; onFocus then skips the reveal, leaving it to
    // the hover path. A keyboard focus arrives with no preceding pointerdown, so it still
    // reveals. The flag self-clears on the next tick in case a pointerdown never focuses.
    let pointerFocus = false
    const onPointerDownFocus = (): void => {
      pointerFocus = true
      setTimeout(() => {
        pointerFocus = false
      }, 0)
    }
    // Keyboard users get the same hint: with no cursor to follow, anchor it to the
    // trigger's box, and let Escape dismiss it without moving focus (WCAG 1.4.13). Focus
    // skips the hover delay — the wait only earns its keep against an idle pointer.
    const onFocus = (): void => {
      if (pointerFocus) return
      clearTimer()
      shown = true
      const r = trigger.getBoundingClientRect()
      showAt(r.left + r.width / 2, r.bottom)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onLeave()
    }
    trigger.addEventListener('pointerenter', onEnter)
    trigger.addEventListener('keydown', onKeyDown)
    // An editable trigger opts out of the focus reveal (it would cover the text being
    // typed); the pointer listeners above still give it a normal hover hint.
    if (!hoverOnly) {
      trigger.addEventListener('pointerdown', onPointerDownFocus)
      trigger.addEventListener('focusin', onFocus)
      trigger.addEventListener('focusout', onLeave)
    }
    return () => {
      trigger.removeEventListener('pointerenter', onEnter)
      trigger.removeEventListener('keydown', onKeyDown)
      trigger.removeEventListener('pointerdown', onPointerDownFocus)
      trigger.removeEventListener('focusin', onFocus)
      trigger.removeEventListener('focusout', onLeave)
      stopTracking()
      clearTimer()
      // Close on the way out. The listeners are the only thing that ever HID the
      // tooltip, so a trigger that vanishes while it is up (its section folds, the
      // view switches, the button is swapped) left the portal stranded on screen —
      // a "Move the cut forward" hanging over the spectrogram, belonging to a
      // button that no longer exists.
      setPos(null)
    }
  }, [hoverOnly])

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
            {hint && <span className="ml-2 text-fg-faint">{hint}</span>}
          </span>,
          document.body,
        )}
    </span>
  )
}
