import type React from 'react'

export function WaveSpinner(): React.JSX.Element {
  return (
    <div className="flex items-end gap-1" data-testid="wave-spinner" aria-label="Analizando">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{ animation: 'wave 1s ease-in-out infinite', animationDelay: `${i * 0.12}s` }}
          className="h-6 w-1 origin-bottom rounded-full bg-[var(--color-accent)]"
        />
      ))}
    </div>
  )
}
