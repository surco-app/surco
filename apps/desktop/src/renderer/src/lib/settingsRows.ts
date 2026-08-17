// Shared look for the two reorderable settings lists — Fields and Editor sections. Both
// are tables: a name that takes the slack, then repeating state columns, then the reorder
// arrows. What they share is the LOOK of a state cell, not the column track, because the
// two lists genuinely carry different controls; forcing one grid string on both would mean
// a column that exists only to stay empty in one of them.

// A state cell: an icon toggle, matching the eye that marks a section visible so the whole
// table speaks one language. The two states are different SHAPES, not one shape in two
// colours — CircleCheck filled when on, CircleDashed outlined when off — so the column can
// be read at a glance and still works for anyone who can't separate the two colours.
// aria-pressed carries the state for a screen reader, and aria-label the name, since the
// word itself lives in the column heading rather than in every row.
export const TOGGLE_BOX =
  'mx-auto flex h-6 w-6 items-center justify-center rounded disabled:opacity-25'
export const TOGGLE_ON = 'text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]'
export const TOGGLE_OFF = 'text-fg-dim hover:bg-[var(--color-panel-2)] hover:text-fg-muted'

// The column headings strip above a list: same grid as its rows (passed in by the caller,
// since the two lists differ), sized and coloured to sit quietly above them.
export const COLUMN_HEAD = 'mb-1 px-2 text-[10px] uppercase text-fg-faint'

// One heading cell: the label, its ⓘ, and room between them.
export const COLUMN_HEAD_CELL =
  'relative flex cursor-help items-center justify-center gap-1.5 whitespace-nowrap text-fg-dim hover:text-fg-muted'
