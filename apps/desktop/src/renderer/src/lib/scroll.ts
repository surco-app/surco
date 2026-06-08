// Page-style scrolling for keyboard list navigation. Stepping onto a row that sits
// past the viewport edge jumps a page so the row the user came from stays on screen
// as a single line of context: the old edge row becomes the new top (going down) or
// bottom (going up), and the freshly selected row sits just inside it. A row already
// comfortably in view returns null, so mid-list steps don't scroll the list at all.
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
  if (delta > 0 && rowBottom > visibleBottom) {
    return scrollTop + rowTop - headerH - rowStep
  }
  if (delta < 0 && rowTop < headerH) {
    return scrollTop + rowBottom - visibleBottom + rowStep
  }
  return null
}
