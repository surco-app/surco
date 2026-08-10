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

// The option row used for normalization mode, theme, output format and key notation
// (here and in onboarding). A recessed track holds the segments so the row reads as
// one setting with N values rather than tabs or loose buttons — the mistake that
// prompted it: content below a bare row reads as the active tab's content. Same
// treatment, larger, as the waveform compare's view switcher; the toolbar's focus
// presets stay trackless on purpose, since none of them may be active and a track
// with no raised segment looks broken. One definition so the instances can't drift
// in styling or in the aria-pressed wiring.
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  testidPrefix,
  labelFor,
  className,
}: Props<T>): React.JSX.Element {
  return (
    <div
      // self-start: several callers stack settings in a flex column, whose default
      // stretch would pull the track to the panel's full width now that it paints a box.
      className={`inline-flex gap-0.5 self-start rounded-[9px] border border-[var(--color-line)] bg-[var(--color-field)] p-[3px] ${className ?? ''}`}
    >
      {options.map((id) => (
        <button
          key={id}
          type="button"
          data-testid={`${testidPrefix}-${id}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          // The active segment sits raised on the track (fill, hairline ring, soft
          // shadow); hovering the rest previews the fill without the relief.
          className={`rounded-md px-4 py-1.5 text-sm transition-colors ${
            value === id
              ? 'bg-[var(--color-panel-2)] text-fg shadow-[0_1px_2px_rgba(0,0,0,0.3),inset_0_0_0_1px_var(--color-line-strong)]'
              : 'text-fg-muted hover:bg-[var(--color-panel-2)] hover:text-fg'
          }`}
        >
          {labelFor(id)}
        </button>
      ))}
    </div>
  )
}
