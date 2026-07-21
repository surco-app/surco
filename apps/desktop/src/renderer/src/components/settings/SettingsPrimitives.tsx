import type React from 'react'
import { SECTION_SUBHEAD } from '../SectionSubhead'

// The three shared typographic roles every settings tab draws from, so the panels read as
// one system instead of each tab hand-rolling its own label/hint/eyebrow. Kept as thin
// wrappers (not just class strings) so a tab that needs a different element or extra layout
// classes still composes through the same source of truth.

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
    <p data-testid={testid} className={`text-xs text-fg-dim ${className}`}>
      {children}
    </p>
  )
}
