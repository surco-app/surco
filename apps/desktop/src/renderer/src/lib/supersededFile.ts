import type { TrackItem } from '../types'

// The file a finished replacement left behind, or null when there is nothing to offer.
//
// A replacement retires the old copy from Apple Music and repoints rekordbox at the new
// file, so the superseded one is referenced by nothing: it is exactly the orphan the user
// described on 15/09, taking up disk while belonging to no library.
//
// Offered, never deleted automatically. Three runs on 15/09 looked like a correct
// replacement and were not; an automatic delete in any of them would have destroyed the
// only copy. Gating on 'done' matters for the same reason: a conversion that failed or is
// still running must leave every file exactly where it was.
export function supersededFile(track: TrackItem): string | null {
  if (track.status !== 'done') return null
  if (!track.replacesPath || track.supersededTrashed) return null
  // Never offer the file the track now points at: a same-path conversion would otherwise
  // invite deleting the very output it just produced.
  if (track.replacesPath === track.outputPath) return null
  return track.replacesPath
}
