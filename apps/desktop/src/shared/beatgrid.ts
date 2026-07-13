// The staged beatgrid's shared math. Lives in shared next to trim.ts for the
// same reason: main repairs stored session values with it, the renderer
// validates what the editor stages and offsets anchors for the DJ exports.
import type { Beatgrid, GridChange } from './types'

// Wider than any real record on either side (DJ software displays roughly
// 20–999); outside this a grid renders as a wall of lines or one line per song.
const MIN_BPM = 20
const MAX_BPM = 999

function validBpm(bpm: unknown): bpm is number {
  return typeof bpm === 'number' && Number.isFinite(bpm) && bpm >= MIN_BPM && bpm <= MAX_BPM
}

// The changes list gets the same degrade-not-error treatment as the base grid,
// but entry by entry: one typo in a hand-edited session.json must not throw
// away the segments that are fine. Kept are the entries that are valid AND
// keep the anchors strictly increasing past the base one, scanned in order.
function normalizeChanges(value: unknown, baseAnchorSec: number): GridChange[] {
  if (!Array.isArray(value)) return []
  const changes: GridChange[] = []
  let lastAnchor = baseAnchorSec
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue
    const { anchorSec, bpm } = entry as { anchorSec?: unknown; bpm?: unknown }
    if (!validBpm(bpm)) continue
    if (typeof anchorSec !== 'number' || !Number.isFinite(anchorSec) || anchorSec <= lastAnchor)
      continue
    changes.push({ anchorSec, bpm })
    lastAnchor = anchorSec
  }
  return changes
}

// Repairs any stored value into a usable grid: both fields must be finite
// numbers, bpm inside the displayable range, anchor non-negative. Anything
// unusable degrades to undefined — "no grid" — never to an error.
export function normalizeBeatgrid(value: unknown): Beatgrid | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { bpm, anchorSec, changes } = value as {
    bpm?: unknown
    anchorSec?: unknown
    changes?: unknown
  }
  if (!validBpm(bpm)) return undefined
  if (typeof anchorSec !== 'number' || !Number.isFinite(anchorSec) || anchorSec < 0)
    return undefined
  const kept = normalizeChanges(changes, anchorSec)
  return kept.length > 0 ? { bpm, anchorSec, changes: kept } : { bpm, anchorSec }
}

// The walk every consumer shares: the grid as ordered segments, base first.
// Segment k governs from its anchor to the next segment's (the last to the end
// of the track); the base segment also extends backward to the file start.
export function gridSegments(grid: Beatgrid): GridChange[] {
  return [{ anchorSec: grid.anchorSec, bpm: grid.bpm }, ...(grid.changes ?? [])]
}

// Where a staged grid lands in a converted output's timeline: a staged trim is
// always applied by the conversion (it forces a re-encode), so every anchor
// moves back by the cut head. A cut landing inside a later segment re-bases the
// grid on THAT segment — its bpm, its beat phase, folded onto the first
// surviving beat — and the swallowed changes drop: the exported file starts
// under the segment's grid, not under the long-gone base. Shared by the tag
// writes in main and the Engine DJ add.
export function outputBeatgrid(
  grid: Beatgrid | undefined,
  trim: { startSec?: number } | undefined,
): Beatgrid | undefined {
  const cut = trim?.startSec ?? 0
  if (!grid || cut === 0) return grid
  const segments = gridSegments(grid)
  let governing = segments[0]
  for (const segment of segments) {
    if (segment.anchorSec > cut) break
    governing = segment
  }
  const anchor = governing.anchorSec - cut
  const kept = (grid.changes ?? [])
    .filter((c) => c.anchorSec > cut)
    .map((c) => ({ anchorSec: c.anchorSec - cut, bpm: c.bpm }))
  return {
    bpm: governing.bpm,
    anchorSec: anchor < 0 ? snapAnchor(anchor, governing.bpm) : anchor,
    ...(kept.length > 0 ? { changes: kept } : {}),
  }
}

// Folds an anchor by whole beats into [0, 60/bpm) — the same grid, expressed as
// its first non-negative beat. Used when a nudge crosses zero and when a trim
// offset at export time pushes the anchor negative.
export function snapAnchor(anchorSec: number, bpm: number): number {
  const period = 60 / bpm
  const folded = anchorSec % period
  return folded < 0 ? folded + period : folded
}
