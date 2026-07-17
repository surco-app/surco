// The repair section's pure geometry: which click marks to draw over the visible
// window, and where the "jump to the next click" key lands.

export interface ClickMark {
  sec: number
  pct: number
}

// A dusty side can carry hundreds of clicks. Drawn full-length at overview zoom they
// paint a solid wall over the wave: it reads as "the whole track is broken" and buries
// the thing the marks exist to show — WHERE the damage clusters. Above this count the
// visible field thins by a stride; zooming in narrows the window and brings the rest
// back, so nothing is permanently hidden.
export const MAX_MARKS = 96

export function clickMarks(
  marks: number[],
  durationSec: number,
  view: { from: number; to: number },
): ClickMark[] {
  if (durationSec <= 0) return []
  const fromSec = view.from * durationSec
  const toSec = view.to * durationSec
  const visible = marks.filter((sec) => sec >= fromSec && sec <= toSec)
  const stride = Math.ceil(visible.length / MAX_MARKS)
  return visible
    .filter((_, i) => i % stride === 0)
    .map((sec) => ({ sec, pct: (sec / durationSec) * 100 }))
}

// The next click after the playhead, wrapping at the end — clicks last milliseconds, so
// hunting for them by dragging is hopeless; this is what makes marking them useful.
// null when the track is clean and there is nowhere to go.
export function nextClick(marks: number[], afterSec: number): number | null {
  if (marks.length === 0) return null
  // Strictly after, so pressing the key while sitting on a click advances instead of
  // snapping back to the same one forever.
  return marks.find((sec) => sec > afterSec) ?? marks[0]
}
