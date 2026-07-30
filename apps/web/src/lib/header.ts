// Scroll offsets where the header switches between its tall and condensed states.
// They are deliberately different: with one shared threshold, a scroll position
// resting on it flips the state every frame.
const CONDENSE_AT = 64
const EXPAND_AT = 8

// Hysteretic: past CONDENSE_AT it condenses, and it only expands again once the page
// is back near the very top. Between the two it holds whatever state it already had,
// so no scroll position can oscillate.
export function isCondensed(scrollY: number, current: boolean): boolean {
  if (scrollY > CONDENSE_AT) return true
  if (scrollY < EXPAND_AT) return false
  return current
}
