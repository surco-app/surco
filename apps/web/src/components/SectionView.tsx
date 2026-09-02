import { useEffect, useRef } from 'react'
import { type SectionLocation, trackSectionView } from '../lib/analytics'

// Reports once when the section it wraps scrolls into view. Kept apart from Reveal,
// which runs its own observer for the entrance animation: that one fires at a threshold
// chosen to look right, and tying a measurement to it would make any future tweak of the
// animation silently move the numbers.
//
// Renders no element of its own — it observes its parent — so it can sit inside any
// layout without adding a wrapper div that would disturb the surrounding flex or grid.
export default function SectionView({ location }: { location: SectionLocation }) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        // Disconnected before reporting, so a section scrolled past twice counts one
        // visitor reaching it rather than inflating with every pass.
        io.disconnect()
        trackSectionView(location)
      },
      { threshold: 0.25 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [location])

  return <span ref={ref} aria-hidden="true" className="hidden" />
}
