import type React from 'react'

// The label that opens a phase of the editor (File / Audio / Output). The editor is a
// flat list of same-weight sections; without a marker the eye can't tell where
// "describe the file" ends and "operate on the audio" begins.
//
// The label leads, then a hairline runs from its side out to the panel edge — the trailing
// rule is what marks a PHASE as a different KIND of element than a section's own uppercase
// subheads (Properties' "AUDIO"/"FILE" captions, Loudness' "LOUDNESS"), which carry no such
// line. This replaced a full-width rule that used to cross the whole panel ABOVE the label:
// stacked a few pixels from each section's own hairlines, it read as too many lines. One
// short line beside the word, and generous space below it, does the separating instead.
//
// Rendered by Editor whenever the group changes down the user-ordered list, so a reordered
// list still labels correctly.
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
    <div data-testid={testid} className={`flex items-center gap-3 ${first ? 'mb-4' : 'mt-9 mb-5'}`}>
      {/* The phase label leads, then a hairline runs from its side out to the panel edge.
          It replaces the full-width top rule that used to cross the whole panel: one short
          line beside the word instead of a heavy band above it, so a column of phases reads
          as a sequence of labels, not a stack of dividers. */}
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-fg-dim">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--color-line)]" />
    </div>
  )
}
