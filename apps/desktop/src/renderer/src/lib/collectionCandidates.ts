import type { AppleMusicLookupCandidate, CollectionTrack } from '../../../shared/types'

export function collectionCandidates(tracks: CollectionTrack[]): AppleMusicLookupCandidate[] {
  return tracks.flatMap(({ title, artist, durationSec, path }) =>
    path ? [{ title, artist, durationSec, path }] : [],
  )
}
