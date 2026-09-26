import type React from 'react'
import { SECTION_SUBHEAD } from '../SectionSubhead'
import { CheckboxRow } from './CheckboxRow'

// The shared building blocks every settings tab draws from, so the panels read as one
// system instead of each tab hand-rolling its own label/hint/eyebrow and its own margins.
// Kept as thin wrappers (not just class strings) so a tab that needs a different element or
// extra layout classes still composes through the same source of truth.
//
// The spacing scale, applied through these so no tab re-invents it:
//   label → control → hint : 8px  (the SettingsField stack's gap)
//   between options in a group: 16px (SettingsGroup gap)
//   between sections: a hairline with 24px above / 20px below (SettingsSection)

// Opens a group WITHIN a tab (Search's "SEARCH SOURCES"/"DISCOGS"). Shares the editor's
// SECTION_SUBHEAD so a subhead looks the same whether it's in the editor or in settings.
export function SettingsEyebrow({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <p className={`${SECTION_SUBHEAD} ${className}`}>{children}</p>
}

// The name of a single control. Rendered as a <label> when it labels a specific input
// (pass htmlFor), or a plain caption otherwise.
export function SettingsLabel({
  children,
  htmlFor,
  className = '',
}: {
  children: React.ReactNode
  htmlFor?: string
  className?: string
}): React.JSX.Element {
  const cls = `block text-sm font-medium text-fg-muted ${className}`
  return htmlFor ? (
    <label htmlFor={htmlFor} className={cls}>
      {children}
    </label>
  ) : (
    <p className={cls}>{children}</p>
  )
}

// The explanatory line under a control — the "why", one shade back from the label.
export function SettingsHint({
  children,
  className = '',
  'data-testid': testid,
}: {
  children: React.ReactNode
  className?: string
  'data-testid'?: string
}): React.JSX.Element {
  return (
    <p data-testid={testid} className={`text-xs leading-relaxed text-fg-dim ${className}`}>
      {children}
    </p>
  )
}

// A section of a tab: an optional eyebrow, then its body, set off from the section before it
// by a hairline with consistent breathing room. `first` drops the divider and top margin for
// the section that opens a tab. This replaces the per-tab `mt-5 border-t pt-5` scattered as
// utilities so every tab breaks between sections at the same rhythm.
export function SettingsSection({
  eyebrow,
  first = false,
  children,
}: {
  eyebrow?: React.ReactNode
  first?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  // A named section gets a surface of its own. Reported with a screenshot of the Output
  // tab — "the Traktor and the rekordbox section are practically indistinguishable" —
  // where the only separation was a 10px label in dim grey over a 1px rule at 9% opacity:
  // the smallest type on the screen carrying the job of saying where one block ends. An
  // edge that closes underneath is what makes two stacked blocks read as two things.
  //
  // Only when it is named: an unnamed section is a plain grouping of controls, and boxing
  // it would draw a card around something that never asked to be one. Those keep the rule
  // they had.
  if (!eyebrow) {
    return (
      <section
        data-testid="settings-section"
        className={first ? '' : 'mt-6 border-t border-[var(--color-line)] pt-5'}
      >
        {children}
      </section>
    )
  }
  return (
    <section
      data-testid="settings-section"
      className={`rounded-xl border border-[var(--color-line)] bg-[var(--color-field)] px-4 py-3.5 ${
        first ? '' : 'mt-3'
      }`}
    >
      {/* At reading size and full contrast: the block's name, not a caption above it. */}
      <p className="mb-3 font-semibold text-[13px] text-fg">{eyebrow}</p>
      {children}
    </section>
  )
}

// A label/control/hint stack at the fixed 8px rhythm. Pass the control as children; the
// label and hint bracket it. Keeps every input in the panel spaced identically instead of
// each site choosing its own mb-1.5 / mt-1.5.
export function SettingsField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label?: string
  htmlFor?: string
  hint?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {label && <SettingsLabel htmlFor={htmlFor}>{label}</SettingsLabel>}
      {children}
      {hint && <SettingsHint>{hint}</SettingsHint>}
    </div>
  )
}

// A vertical list of related options (checkboxes or radios) with uniform 16px gaps, so a
// group of toggles never runs together the way a bare stack of <label>s did.
export function SettingsGroup({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <div className={`flex flex-col gap-4 ${className}`}>{children}</div>
}

// One checkbox setting plus its explanatory hint, indented under the label so the hint
// lines up with the label text rather than the checkbox. The unit a SettingsGroup repeats.
export function SettingsCheckboxField({
  testid,
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  testid: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: React.ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div>
      <CheckboxRow
        testid={testid}
        checked={checked}
        onChange={onChange}
        label={label}
        disabled={disabled}
      />
      {/* The hint follows the row's dimmed/enabled state so a disabled option greys out as
          one unit; CheckboxRow already dims its own row, so only the hint needs it here. */}
      {hint && (
        <SettingsHint className={`mt-1.5 pl-7 ${disabled ? 'opacity-50' : ''}`}>
          {hint}
        </SettingsHint>
      )}
    </div>
  )
}
