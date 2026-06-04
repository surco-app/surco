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
