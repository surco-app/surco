export function nextWidth(startWidth: number, deltaX: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, startWidth + deltaX))
}

// The extra width (or negative slack) the widest truncating row needs to show its content
// in full: max over rows of scrollWidth − clientWidth. Positive means a row is clipped and
// the column must grow; negative means every row fits with room to spare, so it can shrink
// to where the longest still fits. Zero when there's nothing to measure, so the caller (a
// double-click-to-fit) leaves the width as it is.
export function contentDeficit(rows: { scrollWidth: number; clientWidth: number }[]): number {
  if (rows.length === 0) return 0
  return Math.max(...rows.map((r) => r.scrollWidth - r.clientWidth))
}

// The element whose overflow actually says how much room a row wants. A `[data-fit]` marker
// sits on the row's flex cell, but the ellipsis is applied to a child (`truncate` on a
// `w-fit max-w-full` span), and a cell never overflows its own box: measuring the marker
// reports 0 for a title that is visibly cut off. Measure the deepest truncating descendant
// instead, falling back to the marker when a row has none.
export function fitProbe(marker: {
  scrollWidth: number
  clientWidth: number
  querySelectorAll: (s: string) => ArrayLike<{ scrollWidth: number; clientWidth: number }>
}): { scrollWidth: number; clientWidth: number } {
  let widest: { scrollWidth: number; clientWidth: number } = marker
  for (const el of Array.from(marker.querySelectorAll('.truncate'))) {
    if (el.scrollWidth - el.clientWidth > widest.scrollWidth - widest.clientWidth) widest = el
  }
  return widest
}

// The width a column should take when the window grows. The two left columns are sized in
// pixels and the editor is the flex child, so every pixel a window gains went to the editor
// and the track and release names stayed clipped in a window with room to spare.
//
// A column only ever grows here, only as far as its content is short by, and only out of
// `spare` — the width left once the editor has its minimum. Shrinking is left to the drag
// and to double-click-to-fit: those are gestures the user asked for, and taking width back
// off a column while they read it is not.
export function growToSpare(
  column: { width: number; deficit: number; max: number },
  spare: number,
): number {
  const wanted = Math.min(column.deficit, spare)
  if (wanted <= 0) return column.width
  return Math.min(column.max, column.width + wanted)
}
