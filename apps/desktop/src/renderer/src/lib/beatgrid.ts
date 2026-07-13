// The grid section's pure geometry: which beat lines to draw for the visible
// window, and where the stored anchor lands in an exported file's timeline.
import { snapAnchor } from '../../../shared/beatgrid'
import type { Beatgrid, BeatgridResult } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface GridLine {
  sec: number
  pct: number
  downbeat: boolean
}

// A 10-minute techno track holds over a thousand beats; rendered full-length
// they would swamp the DOM — and, at overview zoom, paint an amber wall over
// the whole wave. Above this count the density thins by whole BARS (stride
// multiples of 4), so the overview reads as sparse bar ticks while deep zoom
// shows every beat.
const MAX_LINES = 96

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
  // A NaN anywhere in the beat math makes `sec > toSec` false forever and the
  // loop below allocates until the renderer dies — refuse to draw instead.
  if (!Number.isFinite(period) || !Number.isFinite(grid.anchorSec)) return []
  const spanSec = Math.max(0, (view.to - view.from) * durationSec)
  let stride = 1
  while (spanSec / period / stride > MAX_LINES) stride *= 2
  // Once thinning starts, land on whole bars: a mix of on- and off-bar beats at
  // overview zoom reads as noise, evenly spaced downbeats read as a ruler.
  if (stride > 1) stride = Math.ceil(stride / 4) * 4
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

// The "grid to review" verdict for the attention triage. Absolute correctness
// is unknowable (if we knew the grid was wrong we would fix it), so this flags
// the honest ear-check cases: a shaky tempo, or a beat-vs-off-beat coin flip
// no low-band voter could break (two equal hit trains half a period apart).
// phaseMargin is the strongest low-band voter's word from the chosen side, and
// the detector treats ≥1.3 as decisive — so the review bar matches it: a grid
// the voters settled is trusted, a grid they all shrugged at is parked for an
// ear check. Calibrated against a real sidechained 138 BPM trance track
// (margin 1.94, unflagged), a real 147 BPM hard-dance rip whose grid the
// sub-attack voter fixed (margin 1.50, unflagged), synthesized twins
// (ambiguity 1.0, margin 1.0, flagged), and ordinary off-beat-bass dance
// music living at 0.6–0.9 ambiguity (under the 0.9 bar, never flagged).
const REVIEW_MIN_CONFIDENCE = 0.3
const REVIEW_AMBIGUITY = 0.9
const REVIEW_MARGIN = 1.3

export function beatgridNeedsReview(result: BeatgridResult | null | undefined): boolean {
  if (!result) return false
  if (result.confidence < REVIEW_MIN_CONFIDENCE) return true
  return result.phaseAmbiguity > REVIEW_AMBIGUITY && result.phaseMargin < REVIEW_MARGIN
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
