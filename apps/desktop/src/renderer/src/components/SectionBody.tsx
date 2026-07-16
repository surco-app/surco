import type React from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

// The open/close transition for an editor section's body. It wraps the `{open && …}` each
// section used to inline, and adds three things that snapping in and out never had:
//
//  • a measured height tween (max-height animated to the body's real scrollHeight), so the
//    panel grows and collapses smoothly instead of jumping the whole layout at once;
//  • a re-measure via ResizeObserver, because these bodies grow AFTER they mount — the
//    spectrum decodes, a waveform loads, a skeleton is swapped for content — and a height
//    measured once at open would clip the late growth. Once fully open the max-height is
//    released to `none`, so any further growth is unconstrained;
//  • deferred unmount: on close the children stay mounted through the collapse and drop on
//    transitionend, so the shrink is actually seen.
//
// The heavy work itself (spectrum/waveform decode) stays gated on `open` inside each
// section's own hooks — this only governs when the body is in the tree and how tall its
// box is, so a folded section still pays nothing.

const DURATION_MS = 240
const EASE = 'cubic-bezier(0.2, 0, 0, 1)'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

interface Props {
  open: boolean
  children: React.ReactNode
}

export function SectionBody({ open, children }: Props): React.JSX.Element | null {
  // Mounted spans the visible life of the body: true while open, and kept true through the
  // close transition so the collapse animates, then flipped off on transitionend.
  const [mounted, setMounted] = useState(open)
  // The animated ceiling. undefined means "no constraint" — used once fully open so async
  // growth isn't clipped, and as the reduced-motion path.
  const [maxHeight, setMaxHeight] = useState<number | undefined>(open ? undefined : 0)
  const innerRef = useRef<HTMLDivElement>(null)
  const reduce = prefersReducedMotion()
  // Latest open/reduce for the callback ref below, so it can read them without being
  // recreated (which would detach and reattach the observer on every render).
  const stateRef = useRef({ open, reduce })
  stateRef.current = { open, reduce }

  // Opening: mount now, then measure and tween to the real height. Closing: tween down to 0
  // from the current height. useLayoutEffect so the from-height is committed before paint,
  // or the first frame would jump.
  useLayoutEffect(() => {
    if (open) {
      setMounted(true)
      if (reduce) {
        setMaxHeight(undefined)
        return
      }
      const el = innerRef.current
      // Not mounted yet on the very first open — the mount effect below re-runs the tween.
      if (!el) return
      setMaxHeight(el.scrollHeight)
    } else if (mounted && reduce) {
      // No transition to wait on, so transitionend would never fire — unmount straight away
      // rather than leaving the body in the tree forever.
      setMounted(false)
      setMaxHeight(0)
    } else if (mounted) {
      const el = innerRef.current
      // Pin the current height first so the transition has a from-value, then drop to 0 on
      // the next frame. Setting 0 directly from `none`/auto wouldn't animate.
      if (el) setMaxHeight(el.scrollHeight)
      requestAnimationFrame(() => setMaxHeight(0))
    } else {
      setMaxHeight(0)
    }
  }, [open, mounted, reduce])

  // A callback ref for the measured body: it fires exactly when the node mounts and
  // unmounts, which is what the tween needs — on the first open the body isn't in the DOM
  // during the layout effect above, so this is where it gets measured and where the
  // ResizeObserver (for late spectrum/waveform growth) is wired. Reading open/reduce
  // through stateRef keeps the callback stable so React doesn't detach it every render.
  const roRef = useRef<ResizeObserver | null>(null)
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    innerRef.current = el
    roRef.current?.disconnect()
    roRef.current = null
    if (!el || !stateRef.current.open || stateRef.current.reduce) return
    setMaxHeight(el.scrollHeight)
    if (typeof ResizeObserver === 'undefined') return
    // Only widen the ceiling to fit; never fight a user-driven shrink mid-close.
    const ro = new ResizeObserver(() => {
      if (innerRef.current) setMaxHeight(innerRef.current.scrollHeight)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  const onTransitionEnd = (e: React.TransitionEvent): void => {
    if (e.propertyName !== 'max-height') return
    if (open) {
      // Fully open: release the ceiling so later async growth isn't clipped.
      setMaxHeight(undefined)
    } else {
      // Fully closed: drop the body from the tree.
      setMounted(false)
    }
  }

  if (!mounted && !open) return null

  return (
    <div
      data-testid="section-body"
      data-open={open}
      onTransitionEnd={onTransitionEnd}
      style={{
        maxHeight: maxHeight === undefined ? undefined : `${maxHeight}px`,
        overflow: maxHeight === undefined ? undefined : 'hidden',
        transition: reduce ? undefined : `max-height ${DURATION_MS}ms ${EASE}`,
      }}
    >
      {/* The inner element is what gets measured; the outer clips it during the tween. A
          faint fade+lift of the content itself softens the reveal beyond the height change. */}
      <div
        ref={measureRef}
        style={
          reduce
            ? undefined
            : {
                opacity: open ? 1 : 0,
                transform: open ? 'none' : 'translateY(-4px)',
                transition: `opacity ${DURATION_MS}ms ${EASE}, transform ${DURATION_MS}ms ${EASE}`,
              }
        }
      >
        {children}
      </div>
    </div>
  )
}
