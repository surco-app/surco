import type { TrackItem } from '../types'

// A track is eligible for batch conversion when it has not been processed yet
// (idle) or a previous attempt failed (error). Tracks already done or currently
// processing are skipped so "Convert all" never re-runs or duplicates work.
export function eligibleForBatch(tracks: TrackItem[]): string[] {
  return tracks.filter((t) => t.status === 'idle' || t.status === 'error').map((t) => t.id)
}
