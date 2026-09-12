import { type AmbiguousMatch, isAmbiguous, type RekordboxTrack } from './rekordboxDb'

// Works out what a replacement is about to supersede, before anything is converted or
// deleted.
//
// The ordering is the whole point. Apple Music lets a track's location be read but never
// written, so replacing a library copy is really "add the new one, delete the old one" —
// and once the old copy is gone, nothing can say which file it pointed at. rekordbox
// indexes by that very path, so the repoint has to be told the old path while the entry
// still exists. Everything here is a read.

export interface ReplaceTarget {
  // The file the library entry points at today: the one the conversion supersedes.
  oldPath: string
  // The rekordbox row for that file, or null when the collection does not have it — 117
  // of the user's 1959 library tracks were never imported into rekordbox.
  rekordboxId: string | null
  // Its stored format code, kept so the quality comparison can say what is being given up
  // without reading the old file again.
  oldFileType: number | null
  // Set when one file has several rekordbox rows (34 of the user's do). Repointing one
  // would leave its twin on the replaced file, so the choice goes up to the user.
  ambiguous?: string[]
}

export interface ReplaceTargetDeps {
  entryLocation: (persistentId: string) => Promise<string>
  findTrack: (path: string) => RekordboxTrack | AmbiguousMatch | null
}

export async function resolveReplaceTarget(
  track: { persistentId: string | undefined },
  deps: ReplaceTargetDeps,
): Promise<ReplaceTarget | null> {
  // No library copy means there is nothing being superseded: this is a plain conversion.
  if (!track.persistentId) return null

  let oldPath: string
  try {
    oldPath = await deps.entryLocation(track.persistentId)
  } catch {
    // Music not running, or refusing to answer. The conversion goes ahead without a
    // repoint, which is what happens today anyway.
    return null
  }
  // Music answers with an empty string when it holds no reachable file for the entry — a
  // cloud track, or a reference to something that moved. Nothing to supersede.
  if (!oldPath) return null

  const match = deps.findTrack(oldPath)
  if (match === null) return { oldPath, rekordboxId: null, oldFileType: null }
  if (isAmbiguous(match)) {
    return { oldPath, rekordboxId: null, oldFileType: null, ambiguous: match.ambiguous }
  }
  return { oldPath, rekordboxId: match.id, oldFileType: match.fileType }
}
