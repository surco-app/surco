import type { RepointResult } from './rekordboxLibrary'
import type { ReplaceTarget } from './replaceTarget'

// Substituting a track that is already in the library: the new file takes the old one's
// place, and every library that pointed at the old file follows it.
//
// The order is the load-bearing part. Apple Music lets a track's location be read but
// never written, so replacing a library copy means adding the new one and deleting the
// old — and after that, nothing can say which file the entry used to point at. rekordbox
// indexes by exactly that path. So the old path is read first, while the entry still
// exists, and the library is touched last.

export interface ReplaceFlowResult {
  // Whether a library copy was superseded. False for a plain conversion of a track the
  // library never had.
  replaced: boolean
  newPath: string
  oldPath?: string
  repointed: boolean
  // Why the collection was not updated, when it could have been but was refused —
  // rekordbox open, the collection read-only. The conversion still stands.
  repointBlocked?: string
  // Two rekordbox rows for one file: the caller has to ask which one to keep.
  ambiguous?: string[]
  persistentId?: string
}

export interface ReplaceFlowDeps {
  // Reads where the library copy points today. Must run before anything is replaced.
  resolveTarget: () => Promise<ReplaceTarget | null>
  // Produces the new file and returns where it landed.
  convert: () => Promise<string>
  repoint: (rekordboxId: string, from: string, to: string) => Promise<RepointResult>
  // Adds the new file to the library and removes the copy it supersedes.
  replaceInLibrary: (newPath: string, oldPath: string) => Promise<string>
}

export async function runReplaceFlow(deps: ReplaceFlowDeps): Promise<ReplaceFlowResult> {
  // First, while the library entry still points at the old file.
  const target = await deps.resolveTarget()

  // The conversion is what produces the file everything below points at, so a failure
  // here has to stop the flow: repointing to a file that was never written would trade
  // the user's working entry for a missing one.
  const newPath = await deps.convert()

  if (!target) return { replaced: false, newPath, repointed: false }

  let repointed = false
  let repointBlocked: string | undefined
  if (target.rekordboxId) {
    const result = await deps.repoint(target.rekordboxId, target.oldPath, newPath)
    repointed = result.written
    // A refused repoint must not cost the user the conversion: the file is on disk and
    // the library copy is still worth updating. The reason travels up instead.
    if (!result.written) repointBlocked = result.reason
  }

  const persistentId = await deps.replaceInLibrary(newPath, target.oldPath)

  return {
    replaced: true,
    newPath,
    oldPath: target.oldPath,
    repointed,
    ...(repointBlocked && { repointBlocked }),
    ...(target.ambiguous && { ambiguous: target.ambiguous }),
    persistentId,
  }
}
