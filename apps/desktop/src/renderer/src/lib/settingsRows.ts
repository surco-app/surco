// Shared look for the two reorderable settings lists — Fields and Editor sections. Both
// are tables: a name that takes the slack, then repeating state columns, then the reorder
// arrows. What they share is the LOOK of a state cell, not the column track, because the
// two lists genuinely carry different controls; forcing one grid string on both would mean
// a column that exists only to stay empty in one of them.

// The square state box. Its column heading carries the word, so the box holds only a mark:
// a column of them scans as a pattern rather than a wall of the same word repeated down
// every row — which is what it replaced, and what forced each cell wide enough to hold the
// longest translation. 24px keeps it a comfortable click target without reading as a button.
export const TOGGLE_BOX = 'mx-auto flex h-6 w-6 items-center justify-center rounded'

// On: filled with the accent. Off: an outline, so the control is visible before it is ever
// used — an empty cell with no border reads as "nothing here" rather than "not set".
export const TOGGLE_ON = 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
export const TOGGLE_OFF =
  'border border-[var(--color-line)] text-transparent hover:border-[var(--color-line-strong)]'

// The column headings strip above a list: same grid as its rows (passed in by the caller,
// since the two lists differ), sized and coloured to sit quietly above them.
export const COLUMN_HEAD = 'mb-1 px-2 text-[10px] uppercase text-fg-faint'

// One heading cell: the label, its ⓘ, and room between them.
export const COLUMN_HEAD_CELL =
  'relative flex cursor-help items-center justify-center gap-1.5 whitespace-nowrap text-fg-dim hover:text-fg-muted'
