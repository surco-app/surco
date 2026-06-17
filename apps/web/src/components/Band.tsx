import type { ReactNode } from 'react'

// Full-bleed contrast band. It breaks out of the centered max-w column so the
// wrapped section can carry its own background — the page then reads as alternating
// bands instead of one flat wall — and re-constrains its content to the same column.
// The 100vw width relies on overflow-x-clip on the page root so it never adds a
// horizontal scrollbar.
export default function Band({
  children,
  tone = 'raised',
  className = ''
}: {
  children: ReactNode
  tone?: 'deep' | 'raised'
  className?: string
}) {
  const bg =
    tone === 'deep'
      ? 'border-y border-line/50 bg-bg2'
      : 'border-y border-line/40 bg-surface2/30'
  return (
    <div className={`relative ml-[calc(50%-50vw)] w-screen ${bg} ${className}`}>
      <div className="mx-auto max-w-5xl px-6">{children}</div>
    </div>
  )
}
