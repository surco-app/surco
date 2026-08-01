// Which section header a jump lands on. The editor carries 133 tab stops with a single
// section open, so tabbing from the title field to the silence trimmer means crossing
// dozens of inputs; these jumps step over the fields entirely, header to header.
//
// `shown` is the sections actually on screen, in the user's own order — hidden ones and
// ones whose condition does not hold are already out, so a jump can never land on a
// header that is not there.
export function nextSection(
  shown: string[],
  current: string | null,
  dir: 1 | -1,
): string | null {
  if (shown.length === 0) return null
  const at = current === null ? -1 : shown.indexOf(current)
  // Nothing focused yet, or the focused section vanished under the user: start at the
  // top rather than stranding the keys.
  if (at === -1) return shown[0]
  // No wrapping. With the list scrolled the end is off screen, so jumping from the last
  // section back to the first reads as the keys having lost their place.
  const to = Math.min(shown.length - 1, Math.max(0, at + dir))
  return shown[to]
}
