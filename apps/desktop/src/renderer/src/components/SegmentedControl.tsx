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

// The pill-style option row used for theme, output format and key notation (here and
// in onboarding): one selected segment, the rest quiet. One definition so the four
// instances can't drift in styling or in the aria-pressed wiring.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testidPrefix,
  labelFor,
  className,
}: Props<T>): React.JSX.Element {
  return (
    <div className={`inline-flex gap-1 rounded-lg bg-[var(--color-field)] p-1 ${className ?? ''}`}>
      {options.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`${testidPrefix}-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          // The selected segment reads as a RAISED pill — a soft shadow + a hairline top
          // highlight lift it off the recessed track, the way a macOS segmented control's
          // knob sits proud. Colour alone (panel-2 on the dark track) was too subtle a
          // difference to call the active state unmistakably.
          className={`rounded-md px-4 py-1.5 text-sm transition-all ${
            value === id
              ? 'bg-[var(--color-panel-2)] text-fg shadow-sm ring-1 ring-[var(--color-line)]'
              : 'text-fg-muted hover:text-fg'
          }`}
        >
          {labelFor(id)}
        </button>
      ))}
    </div>
  )
}
