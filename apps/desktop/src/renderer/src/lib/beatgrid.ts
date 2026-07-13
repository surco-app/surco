// The grid section's pure geometry: which beat lines to draw for the visible
// window, and where the stored grid lands in an exported file's timeline.
import { gridSegments, outputBeatgrid } from '../../../shared/beatgrid'
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
// grid may hold several segments: each change re-anchors the beats (and the
// downbeat count — its anchor is beat 1) from its own anchor until the next
// change, and the previous segment stops AT the change. The base segment also
// extends backward from its anchor — whatever beat the user grabbed, possibly
// mid-song — so the grid always covers the whole track.
export function gridLines(
  grid: Beatgrid,
  durationSec: number,
  view: { from: number; to: number },
): GridLine[] {
  if (durationSec <= 0) return []
  const segments = gridSegments(grid)
  // A NaN anywhere in the beat math makes `sec > toSec` false forever and the
  // loop below allocates until the renderer dies — refuse to draw instead.
  for (const s of segments) {
    const period = 60 / s.bpm
    if (!Number.isFinite(period) || period <= 0 || !Number.isFinite(s.anchorSec)) return []
  }
  const viewFromSec = view.from * durationSec
  const viewToSec = view.to * durationSec
  // The thinning stride bounds what's IN VIEW, summed across the segments the
  // view overlaps — with one shared stride, so the ruler stays even across a
  // change instead of re-densifying mid-strip.
  let visibleBeats = 0
  for (let i = 0; i < segments.length; i++) {
    const segStart = i === 0 ? 0 : segments[i].anchorSec
    const segEnd = segments[i + 1]?.anchorSec ?? durationSec
    const overlap = Math.min(segEnd, viewToSec) - Math.max(segStart, viewFromSec)
    if (overlap > 0) visibleBeats += overlap / (60 / segments[i].bpm)
  }
  let stride = 1
  while (visibleBeats / stride > MAX_LINES) stride *= 2
  // Once thinning starts, land on whole bars: a mix of on- and off-bar beats at
  // overview zoom reads as noise, evenly spaced downbeats read as a ruler.
  if (stride > 1) stride = Math.ceil(stride / 4) * 4

  const lines: GridLine[] = []
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const period = 60 / seg.bpm
    const segStart = i === 0 ? 0 : seg.anchorSec
    const segEnd = segments[i + 1]?.anchorSec ?? durationSec
    const fromSec = Math.max(segStart, viewFromSec - period)
    const toSec = Math.min(segEnd, durationSec, viewToSec + period)
    if (toSec < fromSec) continue
    // First rendered beat at or before fromSec, aligned to the stride so the
    // same beats stay rendered while the view scrolls (no shimmering lines) —
    // and never before the segment's own anchor for a non-base segment.
    const first = Math.floor((fromSec - seg.anchorSec) / period / stride) * stride
    for (let k = i === 0 ? first : Math.max(first, 0); ; k += stride) {
      const sec = seg.anchorSec + k * period
      if (sec > toSec) break
      // The change anchor belongs to the NEXT segment (its k = 0, a downbeat);
      // the previous grid must not double-draw a line on top of it.
      if (i < segments.length - 1 && sec >= segEnd - 1e-9) break
      if (sec < fromSec) continue
      lines.push({
        sec,
        pct: (sec / durationSec) * 100,
        downbeat: ((k % 4) + 4) % 4 === 0,
      })
    }
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

// Where the stored grid (original-file seconds) lands in the file an export
// references. A converted output had the staged trim cut from its head, so
// every anchor shifts back by it; the original file still carries its head, so
// a merely staged trim must NOT move the grid. When the trim swallows anchors,
// outputBeatgrid re-bases on the surviving segment — DJ software accepts no
// negative marker. Known limit, same one the Update button already surfaces: a
// trim staged after the last conversion misaligns until re-convert.
export function exportedBeatgrid(
  track: Pick<TrackItem, 'beatgrid' | 'trim' | 'outputPath'>,
): Beatgrid | undefined {
  const grid = track.beatgrid
  if (!grid) return undefined
  return track.outputPath ? outputBeatgrid(grid, track.trim) : grid
}

export function exportAnchorSec(
  track: Pick<TrackItem, 'beatgrid' | 'trim' | 'outputPath'>,
): number | undefined {
  return exportedBeatgrid(track)?.anchorSec
}
