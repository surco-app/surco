import type { TrackItem } from '../types'
import { isAmbiguousCandidate, type ReplaceCandidate } from './appleMusicLibrary'

// What to stamp on a track before converting it, so the conversion replaces the library
// copy it supersedes instead of adding a second one.
//
// musicPersistentId is the field that decides this: with it, processTrack updates that
// exact Music entry; without it, it imports a fresh one. A track Surco added earns the ID
// from the add — a file the user merely loaded never had one, which is why the convert
// produced a sibling entry even while the button offered a replacement.
//
// Ambiguous matches deliberately stamp nothing: overwriting on a guess can destroy the
// wrong song, and the add is the safe outcome.
export function replacePatch(target: ReplaceCandidate | null): Partial<TrackItem> | null {
  if (!target || isAmbiguousCandidate(target)) return null
  // replacesPath comes from the candidate, never from a fresh lookup: it must name the file
  // the user was shown, and Music's answer changes the moment an earlier replacement
  // repoints that entry (see StaleLibraryCopy.path).
  return target.path
    ? { musicPersistentId: target.persistentId, replacesPath: target.path }
    : { musicPersistentId: target.persistentId }
}
