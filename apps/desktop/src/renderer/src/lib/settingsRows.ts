// Shared look for the two reorderable settings lists — Fields and Editor sections. Both
// are tables: a name that takes the slack, then repeating state columns, then the reorder
// arrows. What they share is the LOOK of a state cell, not the column track, because the
// two lists genuinely carry different controls; forcing one grid string on both would mean
// a column that exists only to stay empty in one of them.

// A state cell: the app's checkbox, centred in its column. It is the real `input` every
// other boolean setting uses (see CheckboxRow) rather than a button drawn to look like one
// — that version had to bolt on aria-pressed and aria-label to pass for a checkbox, and
// still missed the platform's own tick, focus ring and space-to-toggle. The column heading
// carries the word, so the cell holds no text: a column of ticks is scanned as a pattern
// instead of read as a wall of the same word repeated down every row.
export const TOGGLE_BOX = 'mx-auto h-4 w-4 accent-[var(--color-accent)]'

// The column headings strip above a list: same grid as its rows (passed in by the caller,
// since the two lists differ), sized and coloured to sit quietly above them.
export const COLUMN_HEAD = 'mb-1 px-2 text-[10px] uppercase text-fg-faint'

// One heading cell: the label, its ⓘ, and room between them.
export const COLUMN_HEAD_CELL =
  'relative flex cursor-help items-center justify-center gap-1.5 whitespace-nowrap text-fg-dim hover:text-fg-muted'
