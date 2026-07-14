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
  className = '',
}: {
  testid: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  // A setting whose dependency is off stays visible but dimmed, so it never vanishes and
  // leaves the user hunting for it. Each tab used to re-derive this by hand.
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <label
      className={`flex items-center gap-3 ${
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
      } ${className}`}
    >
      <input
        data-testid={testid}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--color-accent)]"
      />
      <span className="text-sm">{label}</span>
    </label>
  )
}
