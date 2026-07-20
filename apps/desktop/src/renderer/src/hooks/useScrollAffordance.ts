import { useCallback, useEffect, useRef, useState } from 'react'

interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

// Whether scrolling down would reveal content the user hasn't reached yet. The 1px slack
// absorbs the sub-pixel gap layout leaves at the true bottom, so the affordance clears on
// the last line instead of clinging to it.
export function hasMoreBelow({ scrollTop, clientHeight, scrollHeight }: ScrollMetrics): boolean {
  return scrollTop + clientHeight < scrollHeight - 1
}

// Drives a "there's more below" fade on a scroll container. Returns a ref to attach and a
// flag that is true while content sits below the fold. Recomputes on scroll, on the
// element resizing, and whenever `deps` change (e.g. a settings tab swap swaps the whole
// body, changing its height with no scroll event) so the fade never goes stale.
// biome-ignore lint/suspicious/noExplicitAny: caller passes an opaque dependency list, like useEffect's.
export function useScrollAffordance(deps: any[] = []): {
  ref: React.RefObject<HTMLDivElement | null>
  moreBelow: boolean
} {
  const ref = useRef<HTMLDivElement | null>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  const recompute = useCallback(() => {
    const el = ref.current
    if (el) setMoreBelow(hasMoreBelow(el))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    recompute()
    el.addEventListener('scroll', recompute, { passive: true })
    // ResizeObserver catches the body growing/shrinking without a scroll (a tab's own
    // content resizing). Guarded because jsdom (the test env) has no ResizeObserver;
    // there the scroll listener and `deps` still keep the fade current.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(recompute)
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', recompute)
      ro?.disconnect()
    }
  }, [recompute, ...deps])

  return { ref, moreBelow }
}
