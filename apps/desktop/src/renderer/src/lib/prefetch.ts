import type { TrackItem } from '../types'

// Whether hovering a track should warm its Discogs search and top release. Gated
// on a personal token because it hits the network: the shared app key's 60
// req/min is too scarce to spend speculatively across a whole crate. Needs a
// query to search, which the file's tags/name supply when the track is added.
export function needsDiscogsPrefetch(track: TrackItem, hasToken: boolean): boolean {
  return hasToken && track.query.trim().length > 0
}
