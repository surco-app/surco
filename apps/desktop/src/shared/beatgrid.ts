// The staged beatgrid's shared math. Lives in shared next to trim.ts for the
// same reason: main repairs stored session values with it, the renderer
// validates what the editor stages and offsets anchors for the DJ exports.
import type { Beatgrid } from './types'

// Wider than any real record on either side (DJ software displays roughly
// 20–999); outside this a grid renders as a wall of lines or one line per song.
const MIN_BPM = 20
const MAX_BPM = 999

// Repairs any stored value into a usable grid: both fields must be finite
// numbers, bpm inside the displayable range, anchor non-negative. Anything
// unusable degrades to undefined — "no grid" — never to an error.
export function normalizeBeatgrid(value: unknown): Beatgrid | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { bpm, anchorSec } = value as { bpm?: unknown; anchorSec?: unknown }
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < MIN_BPM || bpm > MAX_BPM)
    return undefined
  if (typeof anchorSec !== 'number' || !Number.isFinite(anchorSec) || anchorSec < 0)
    return undefined
  return { bpm, anchorSec }
}

// Where a staged grid lands in a converted output's timeline: a staged trim is
// always applied by the conversion (it forces a re-encode), so the anchor moves
// back by the cut head — folded onto the same grid's first surviving beat when
// the cut passes it. Shared by the tag writes in main and the Engine DJ add.
export function outputBeatgrid(
  grid: Beatgrid | undefined,
  trim: { startSec?: number } | undefined,
): Beatgrid | undefined {
  const cut = trim?.startSec ?? 0
  if (!grid || cut === 0) return grid
  const anchor = grid.anchorSec - cut
  return { bpm: grid.bpm, anchorSec: anchor < 0 ? snapAnchor(anchor, grid.bpm) : anchor }
}

// Folds an anchor by whole beats into [0, 60/bpm) — the same grid, expressed as
// its first non-negative beat. Used when a nudge crosses zero and when a trim
// offset at export time pushes the anchor negative.
export function snapAnchor(anchorSec: number, bpm: number): number {
  const period = 60 / bpm
  const folded = anchorSec % period
  return folded < 0 ? folded + period : folded
}
