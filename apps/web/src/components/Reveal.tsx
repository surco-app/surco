import { useEffect, useRef, useState, type ReactNode } from 'react'

const FROM_CLASS = {
  up: '',
  left: 'reveal-from-left',
  right: 'reveal-from-right'
} as const

export default function Reveal({
  children,
  delay = 0,
  from = 'up',
  className = ''
}: {
  children: ReactNode
  delay?: number
  from?: keyof typeof FROM_CLASS
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={`reveal-init ${FROM_CLASS[from]} ${shown ? 'reveal-in' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  )
}
