import type React from 'react'

// One boolean setting: the checkbox and its label.
//
// Hand-rolled thirteen times across the settings tabs — the same input, the same four
// utility classes, the same label span — and every new setting copies them again. Only the
// structure lives here: the hints and the spacing between rows stay at the call sites,
// because the tabs genuinely differ there and a component that parameterised every margin
// would cost more to read than the ten lines it replaced.
export function CheckboxRow({
  testid,
  checked,
  onChange,
  label,
  disabled = false,
  note,
  className = '',
}: {
  testid: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  // A setting whose dependency is off stays visible but dimmed, so it never vanishes and
  // leaves the user hunting for it. Each tab used to re-derive this by hand.
  disabled?: boolean
  // Stays at full strength when the row is dimmed: it is the reason the setting is off, and
  // at half opacity it fell to 2.8:1.
  note?: string
  className?: string
}): React.JSX.Element {
  return (
    <label
      // Top-aligned, with the box nudged onto the first line: centred, a label that wraps
      // to two lines left the box floating between them.
      className={`flex items-start gap-3 ${
        disabled ? 'cursor-not-allowed' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        data-testid={testid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className={`mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-accent)] ${disabled ? 'opacity-50' : ''}`}
      />
      <span className="text-sm">
        <span className={disabled ? 'opacity-50' : ''}>{label}</span>
        {note && <span className="ml-2 text-xs text-fg-dim">{note}</span>}
      </span>
    </label>
  )
}
