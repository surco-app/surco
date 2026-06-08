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
