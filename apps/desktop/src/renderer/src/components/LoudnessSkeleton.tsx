import type React from 'react'

// The placeholder for the EBU R128 table while the loudness pass runs. It mirrors
// LoudnessReadout's shape — one label line over a two-column table of rows, each a
// field-coloured cell with a status dot, a label and a value on one line — so the measured
// figures swap in without the rows popping into an empty space. Six is the common set (three
// tidy rows of two); noise floor is the optional seventh.
const CELL_COUNT = 6

export function LoudnessSkeleton(): React.JSX.Element {
  return (
    <div data-testid="loudness-skeleton" className="mt-3">
      <div className="mb-1.5 h-2.5 w-16 animate-pulse rounded bg-[var(--color-panel-2)]" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
        {Array.from({ length: CELL_COUNT }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells, never reordered
            key={i}
            className="flex items-center justify-between gap-3 bg-[var(--color-field)] px-3 py-2"
          >
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-panel-2)]" />
              <span className="h-2.5 w-14 animate-pulse rounded bg-[var(--color-panel-2)]" />
            </span>
            <span className="h-3 w-12 animate-pulse rounded bg-[var(--color-panel-2)]" />
          </div>
        ))}
      </div>
    </div>
  )
}
