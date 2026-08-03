import type { TrackItem } from '../types'

// Whether two track lists hold the same row objects in the same order. Filtering and
// sorting rebuild their array on every pass, so a list that is visually identical still
// arrives as a fresh reference and re-renders everything downstream of it. Comparing by
// object identity (not by id) keeps the row updates that DO matter: updateTrack replaces
// the row object when a field changes, and that new object is what the row re-renders for.
export function sameTracks(a: readonly TrackItem[], b: readonly TrackItem[]): boolean {
  return a.length === b.length && a.every((track, i) => track === b[i])
}
