import type React from 'react'

// The tenue label that opens a phase of the editor (File / Audio / Output). The
// editor is a flat list of same-weight sections; without a marker the eye can't tell
// where "describe the file" ends and "operate on the audio" begins. This heading owns
// the group's top separator so the first section under it drops its own border-t — one
// rule, not two stacked lines. Rendered by Editor whenever the group changes down the
// user-ordered list, so a reordered list still labels correctly.
export function SectionGroupHeading({
  label,
  testid,
  first,
}: {
  label: string
  testid: string
  // The very first group needs no separator above it — nothing precedes it.
  first?: boolean
}): React.JSX.Element {
  return (
    <div
      data-testid={testid}
      className={`${first ? 'mb-1' : 'mt-8 border-t border-[var(--color-line)] pt-6'} text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint`}
    >
      {label}
    </div>
  )
}
