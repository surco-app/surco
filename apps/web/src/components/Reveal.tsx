import { type ReactNode, useEffect, useRef, useState } from 'react'

export default function Reveal({
  children,
  delay = 0,
  eager = false,
  className = '',
}: {
  children: ReactNode
  delay?: number
  eager?: boolean
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'idle' | 'hidden' | 'shown'>('idle')

  useEffect(() => {
    // Eager reveals (above the fold) animate on mount instead of waiting for the
    // observer, so they never sit hidden behind hydration or out-of-view scroll.
    if (eager) {
      setState('shown')
      return
    }
    const el = ref.current
    if (!el) return
    if (el.getBoundingClientRect().top < window.innerHeight) return
    setState('hidden')
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setState('shown')
          io.disconnect()
        }
      },
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager])

  return (
    <div
      ref={ref}
      className={`${eager ? 'reveal-eager' : state === 'idle' ? '' : 'reveal-init'} ${state === 'shown' ? 'reveal-in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
