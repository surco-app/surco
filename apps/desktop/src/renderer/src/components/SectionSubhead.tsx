import type React from 'react'

// The one typography for a caption that opens a group WITHIN a section — Properties'
// "Audio"/"File", Loudness' "Loudness", Metadata's "Identity", Declick/Trim's wave labels.
// Sentence case like the captions in macOS panels: tracked capitals read as a web page.
// Exported as a class string (not only a component) because a couple of sites need the
// heading on a different element — Metadata's group caption is a semantic <h3> — and both
// must draw from a single source so the family never drifts apart again.
export const SECTION_SUBHEAD = 'text-[11px] font-medium text-fg-dim'

// Renders the caption as an h4, one level under the section's own h3 header, so it shows
// in a screen reader's outline; callers pass className for the layout-specific wrapping (a
// flex row with a stepper, a grid col-span) that differs per site.
export function SectionSubhead({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <h4 className={`${SECTION_SUBHEAD} ${className}`}>{children}</h4>
}
