import type { TrackItem } from '../types'
import { isStale } from './dirty'
import { missingRequired } from './fields'

// A track is convertible when it has not been processed yet (idle), a previous attempt
// failed (error), or it was edited after converting (stale — the file no longer matches the
// editor, e.g. a year filled in across the selection after a Discogs apply). A done track
// still in sync, or one mid-process, is skipped so "Convert all" never re-runs duplicate work.
function isConvertible(track: TrackItem): boolean {
  return track.status === 'idle' || track.status === 'error' || isStale(track)
}

// Whether a single track can be converted right now: a convertible state plus every required
// field filled. The same gate the convert button enforces, so the keyboard shortcut and
// command palette can't bypass it and trigger a process that only fails on missing tags.
export function canProcessTrack(track: TrackItem, requiredFields: string[]): boolean {
  return isConvertible(track) && missingRequired(track.meta, requiredFields).length === 0
}

// The tracks "Convert all"/"Convert (N)" will actually process: convertible by state and
// with every required field filled. Gating on completeness here (not only status) keeps the
// count and the toolbar button's enabled state honest — it no longer offers a convert that
// would only error per track — matching the single-track button's gate. Incomplete tracks
// are left out (still flagged in the list), never attempted.
export function eligibleForBatch(tracks: TrackItem[], requiredFields: string[]): string[] {
  return tracks.filter((t) => canProcessTrack(t, requiredFields)).map((t) => t.id)
}

// The outcome of converting one track: it wrote a file, the user skipped it past a
// file conflict, or it errored. Skips are neither success nor failure, so they're
// counted on their own rather than folded into the failure tally.
export type BatchOutcome = 'converted' | 'skipped' | 'failed'

export interface BatchSummary {
  converted: number
  skipped: number
  failed: number
}

// Reduces a batch run (one outcome per track) to per-bucket counts, so the UI can
// report the result at a glance without lumping skips in with genuine failures.
export function summarizeBatch(results: BatchOutcome[]): BatchSummary {
  return {
    converted: results.filter((r) => r === 'converted').length,
    skipped: results.filter((r) => r === 'skipped').length,
    failed: results.filter((r) => r === 'failed').length,
  }
}
