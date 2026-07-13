// The grid section's pure geometry: which beat lines to draw for the visible
// window, and where the stored anchor lands in an exported file's timeline.
import { snapAnchor } from '../../../shared/beatgrid'
import type { Beatgrid } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface GridLine {
  sec: number
  pct: number
  downbeat: boolean
}

// A 10-minute techno track holds over a thousand beats; rendered full-length
// they would swamp the DOM. Above this count the density thins by doubling the
// beat stride, so the overview shows bars while deep zoom shows every beat.
const MAX_LINES = 192

// The beats visible in [view.from, view.to] (fractions of the track), plus one
// beat of margin either side so a line never pops at the viewport edge. The
// anchor is whatever beat the user grabbed — possibly mid-song — so the grid
// extends in both directions from it; beat index k counts from the anchor and
// every fourth is the downbeat.
export function gridLines(
  grid: Beatgrid,
  durationSec: number,
  view: { from: number; to: number },
): GridLine[] {
  if (durationSec <= 0) return []
  const period = 60 / grid.bpm
  const spanSec = Math.max(0, (view.to - view.from) * durationSec)
  let stride = 1
  while (spanSec / period / stride > MAX_LINES) stride *= 2
  const fromSec = Math.max(0, view.from * durationSec - period)
  const toSec = Math.min(durationSec, view.to * durationSec + period)
  // First rendered beat at or before fromSec, aligned to the stride so the same
  // beats stay rendered while the view scrolls (no shimmering lines).
  const first = Math.floor((fromSec - grid.anchorSec) / period / stride) * stride
  const lines: GridLine[] = []
  for (let k = first; ; k += stride) {
    const sec = grid.anchorSec + k * period
    if (sec > toSec) break
    if (sec < Math.max(0, fromSec)) continue
    lines.push({
      sec,
      pct: (sec / durationSec) * 100,
      downbeat: ((k % 4) + 4) % 4 === 0,
    })
  }
  return lines
}

// Where the stored anchor (original-file seconds) lands in the file an export
// references. A converted output had the staged trim cut from its head, so the
// anchor shifts back by it; the original file still carries its head, so a
// merely staged trim must NOT move the grid. When the trim swallows the anchor
// beat, fold forward onto the same grid's first surviving beat — DJ software
// accepts no negative marker. Known limit, same one the Update button already
// surfaces: a trim staged after the last conversion misaligns until re-convert.
export function exportAnchorSec(
  track: Pick<TrackItem, 'beatgrid' | 'trim' | 'outputPath'>,
): number | undefined {
  const grid = track.beatgrid
  if (!grid) return undefined
  const cut = track.outputPath ? (track.trim?.startSec ?? 0) : 0
  const anchor = grid.anchorSec - cut
  return anchor < 0 ? snapAnchor(anchor, grid.bpm) : anchor
}
