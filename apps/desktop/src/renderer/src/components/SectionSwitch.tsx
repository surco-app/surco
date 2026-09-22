import type React from 'react'

export interface SectionToggle {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  testId: string
}

export function SectionSwitch({
  checked,
  disabled,
  onChange,
  testId,
  label,
}: SectionToggle & { label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`press relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${
        checked ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-line-strong)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute left-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-3' : ''
        }`}
      />
    </button>
  )
}
