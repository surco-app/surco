import type React from 'react'

// The one typography for a caption that opens a group WITHIN a section — Properties'
// "AUDIO"/"FILE", Loudness' "LOUDNESS", Metadata's "IDENTITY", Declick/Trim's wave labels.
// Exported as a class string (not only a component) because a couple of sites need the
// heading on a different element — Metadata's group caption is a semantic <h3> — and both
// must draw from a single source so the family never drifts apart again.
export const SECTION_SUBHEAD = 'text-[10px] font-medium uppercase tracking-wider text-fg-dim'

// Renders the caption as a text span; callers pass className for the layout-specific
// wrapping (a flex row with a stepper, a grid col-span) that differs per site.
export function SectionSubhead({
  children,
  className = '',
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return <span className={`${SECTION_SUBHEAD} ${className}`}>{children}</span>
}
