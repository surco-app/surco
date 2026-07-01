import type React from 'react'
import { useLayoutEffect, useRef, useState } from 'react'

// A single line of text that scrolls to reveal its tail on hover — but only when it's
// actually clipped. The player is narrow (it lives in the left column), so a long title
// truncates; rather than widen the whole player, hovering the card slides the title to
// show the rest, then eases back. A title that already fits never moves.
//
// The scroll distance (how far past the box the text runs) can't be known in CSS, so it's
// measured here and handed to the animation as a custom property; the keyframe and the
// `group-hover` trigger live in index.css (.player-marquee).
export function MarqueeText({
  children,
  className = '',
}: {
  children: string
  className?: string
}): React.JSX.Element {
  const innerRef = useRef<HTMLSpanElement>(null)
  const [overflowPx, setOverflowPx] = useState(0)

  // children IS a real dependency: a new title has a different width and must re-measure.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure on title change
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (!inner) return
    // The inner span is shrink-wrapped to the text, the parent is clipped to the box, so
    // their width gap is exactly how far the text overflows. The player's width is fixed
    // while it's open, so a single measure per title is enough — no observer needed.
    const gap = inner.scrollWidth - (inner.parentElement?.clientWidth ?? 0)
    setOverflowPx(gap > 0 ? gap : 0)
  }, [children])

  return (
    <span
      data-testid="marquee"
      data-overflow={overflowPx > 0}
      className={`block overflow-hidden ${className}`}
    >
      <span
        ref={innerRef}
        data-role="inner"
        className={`inline-block max-w-full truncate align-bottom ${
          overflowPx > 0 ? 'player-marquee' : ''
        }`}
        style={
          overflowPx > 0 ? ({ '--marquee-px': `${overflowPx}px` } as React.CSSProperties) : undefined
        }
      >
        {children}
      </span>
    </span>
  )
}
