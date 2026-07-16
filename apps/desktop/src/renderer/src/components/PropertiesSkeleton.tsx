import type React from 'react'

// The placeholder shown while ffprobe reads a fresh track's technical facts. It mirrors
// PropertiesReadout's two-up grid — the AUDIO and FILE groups, each a rounded field-
// coloured card of rows — so the real table swaps in without a layout jump. Pulsing grey
// bars stand in for the label/value of each row.
const AUDIO_ROWS = 8
const FILE_ROWS = 6

function SkeletonGroup({ rows }: { rows: number }): React.JSX.Element {
  return (
    <div>
      <div className="mb-1.5 h-2.5 w-12 animate-pulse rounded bg-[var(--color-panel-2)]" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-[var(--color-line)]">
        {Array.from({ length: rows }, (_, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows, never reordered
            key={i}
            className="flex items-center justify-between gap-3 bg-[var(--color-field)] px-3 py-2"
          >
            <span className="h-2.5 w-16 animate-pulse rounded bg-[var(--color-panel-2)]" />
            <span className="h-2.5 w-10 animate-pulse rounded bg-[var(--color-panel-2)]" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PropertiesSkeleton(): React.JSX.Element {
  return (
    <div data-testid="properties-skeleton" className="mt-3 space-y-3">
      <SkeletonGroup rows={AUDIO_ROWS} />
      <SkeletonGroup rows={FILE_ROWS} />
    </div>
  )
}
