import type React from 'react'

// The placeholder for the EBU R128 pills while the loudness pass runs. It mirrors
// LoudnessReadout's shape — one label line over a single flat row of auto-fit cells, each
// a field-coloured card with a status dot, a label line and a value line — so the measured
// figures swap in without the pills popping into an empty space.
const CELL_COUNT = 7

export function LoudnessSkeleton(): React.JSX.Element {
  return (
    <div data-testid="loudness-skeleton" className="mt-3">
      <div className="mb-1.5 h-2.5 w-16 animate-pulse rounded bg-[var(--color-panel-2)]" />
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr))]">
        {Array.from({ length: CELL_COUNT }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells, never reordered
            key={i}
            className="rounded-lg bg-[var(--color-field)] px-3 py-2"
          >
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-panel-2)]" />
              <span className="h-2 w-10 animate-pulse rounded bg-[var(--color-panel-2)]" />
            </div>
            <span className="mt-1.5 block h-3 w-14 animate-pulse rounded bg-[var(--color-panel-2)]" />
          </div>
        ))}
      </div>
    </div>
  )
}
