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
  const superseded = track.replacesPath ?? track.supersededPath
  if (!superseded || track.supersededTrashed) return null
  // A replacement that failed in Music or had to keep the old entry left that entry still
  // playing the file: trashing it would leave a row in Music that plays nothing.
  if (track.musicStatus === 'error' || track.oldMusicCopyKept) return null
  // Never offer the file the track now points at: a same-path conversion would otherwise
  // invite deleting the very output it just produced.
  if (superseded === track.outputPath) return null
  // A source with a separate output is already offered as the original (selectionStatus).
  if (superseded === track.inputPath && track.outputPath) return null
  return superseded
}
