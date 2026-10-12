// Page-style scrolling for keyboard list navigation. Stepping onto a row that sits
// past the viewport edge jumps a page so the row the user came from stays on screen
// as a single line of context: the old edge row becomes the new top (going down) or
// bottom (going up), and the freshly selected row sits just inside it. A row already
// comfortably in view returns null, so mid-list steps don't scroll the list at all. A row
// off-screen on the other side (the user wheeled away) still pages toward the direction of
// travel, and with no direction (delta 0) the row's own side decides.
//
// All offsets are relative to the scroll container's own top. footerH carves out the
// floating player overlay so a paged-to row never hides behind it; rowStep is one row's
// stride (height + gap), the slice of context kept on screen.
export function pageScrollTop({
  delta,
  rowTop,
  rowBottom,
  viewport,
  headerH,
  footerH,
  rowStep,
  scrollTop,
}: {
  delta: number
  rowTop: number
  rowBottom: number
  viewport: number
  headerH: number
  footerH: number
  rowStep: number
  scrollTop: number
}): number | null {
  const visibleBottom = viewport - footerH
  const below = rowBottom > visibleBottom
  if (!below && rowTop >= headerH) return null
  if (delta > 0 || (delta === 0 && below)) {
    return scrollTop + rowTop - headerH - rowStep
  }
  return scrollTop + rowBottom - visibleBottom + rowStep
}
