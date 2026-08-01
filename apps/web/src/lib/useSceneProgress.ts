import { type RefObject, useEffect, useRef, useState } from 'react'

// Runs a scene's progress from 0 to 1 once it scrolls into view, and hands back the
// raw fraction for the scene's own frame function to turn into state.
//
// Starting on view rather than on mount matters here: these scenes sit well down the
// page, so a mount-time animation would be over before anyone saw it. Reduced motion
// jumps straight to the finished frame instead of leaving a panel frozen at zero —
// the static version of each scene was frozen mid-action, which is the thing this is
// meant to fix.
export function useSceneProgress(ref: RefObject<HTMLElement | null>, durationMs: number): number {
  const [progress, setProgress] = useState(0)
  const raf = useRef(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(1)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        const start = performance.now()
        const step = (now: number) => {
          const p = Math.min(1, (now - start) / durationMs)
          setProgress(p)
          if (p < 1) raf.current = requestAnimationFrame(step)
        }
        raf.current = requestAnimationFrame(step)
      },
      { threshold: 0.3 },
    )
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf.current)
    }
  }, [ref, durationMs])

  return progress
}
