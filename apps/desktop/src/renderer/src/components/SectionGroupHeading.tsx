import type React from 'react'

// The label that opens a phase of the editor (File / Audio / Output). The editor is a
// flat list of same-weight sections; without a marker the eye can't tell where
// "describe the file" ends and "operate on the audio" begins.
//
// It carries a short accent tick before the label so a PHASE marker reads as a
// different KIND of element than a section's own uppercase subheads (Properties'
// "AUDIO"/"FILE" table captions, Loudness' "SIGNAL") — those share this exact size
// and case, and a purely tonal difference left the two colliding (a group "AUDIO"
// sitting right above a table "AUDIO"). The tick is the structural cue text weight
// alone can't give; the label itself sits at fg-muted so the top-level phase reads
// with more presence than the fg-dim captions nested under it, not less.
//
// This heading owns the group's top separator, so the first section under it drops
// its own border-t — one rule, not two stacked lines. Rendered by Editor whenever the
// group changes down the user-ordered list, so a reordered list still labels correctly.
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
      className={`flex items-center gap-2 ${first ? 'mb-2' : 'mt-7 border-t border-[var(--color-line)] pt-6'}`}
    >
      <span
        aria-hidden="true"
        className="h-3 w-0.5 shrink-0 rounded-full bg-[var(--color-accent)]/60"
      />
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-muted">
        {label}
      </span>
    </div>
  )
}
