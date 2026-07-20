import type React from 'react'

interface Props<T extends string> {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  // Each option's data-testid is `${testidPrefix}-${option}`.
  testidPrefix: string
  labelFor: (option: T) => string
  // Extra container classes (margins) — the pill styling itself is fixed.
  className?: string
}

// The option row used for theme, output format and key notation (here and in onboarding):
// one selected segment, the rest quiet. No background track — the segments sit directly on
// the surface, only the active one filled, matching the toolbar's view switcher so every
// segmented control in the app reads as one pattern. One definition so the instances can't
// drift in styling or in the aria-pressed wiring.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testidPrefix,
  labelFor,
  className,
}: Props<T>): React.JSX.Element {
  return (
    <div className={`inline-flex gap-1 ${className ?? ''}`}>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`${testidPrefix}-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          // The active segment is filled (panel-2); the rest are plain text with the same
          // fill on hover, so the row reads as one control without a recessed track behind it.
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            value === id
              ? 'bg-[var(--color-panel-2)] text-fg'
              : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
          }`}
        >
          {labelFor(id)}
        </button>
      ))}
    </div>
  )
}
