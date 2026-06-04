import type { TrackItem } from '../types'
import { missingRequired } from './fields'

// A track is eligible for batch conversion when it has not been processed yet
// (idle) or a previous attempt failed (error). Tracks already done or currently
// processing are skipped so "Convert all" never re-runs or duplicates work.
export function eligibleForBatch(tracks: TrackItem[]): string[] {
  return tracks.filter((t) => t.status === 'idle' || t.status === 'error').map((t) => t.id)
}

// Whether a single track can be converted right now: it must be in a convertible
// state (idle or a previous error) and have every required field filled. This is
// the same gate the convert button enforces, so the keyboard shortcut and command
// palette can't bypass it and trigger a process that only fails on missing tags.
export function canProcessTrack(track: TrackItem, requiredFields: string[]): boolean {
  const convertible = track.status === 'idle' || track.status === 'error'
  return convertible && missingRequired(track.meta, requiredFields).length === 0
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
