import type { RemoveCopyResult } from '../shared/types'

export interface RemoveCopyDeps {
  locate: (persistentId: string) => Promise<string>
  realpath: (path: string) => Promise<string | null>
  transferPlaylists: (
    fromPid: string,
    toPid: string,
    label: string,
    keepLabel: string,
  ) => Promise<string>
  deleteEntry: (persistentId: string, label: string) => Promise<string | null>
}

// Fails closed: when either side can't be resolved, the file might be shared, and
// trashing it would take the kept copy's audio along. Leaving a stray file is recoverable.
async function mayShareFile(a: string, b: string, deps: RemoveCopyDeps): Promise<boolean> {
  if (!a || !b) return true
  const [ra, rb] = await Promise.all([deps.realpath(a), deps.realpath(b)])
  if (ra === null || rb === null) return true
  return ra.normalize('NFC') === rb.normalize('NFC')
}

const none = (outcome: RemoveCopyResult['outcome'], playlists = 0): RemoveCopyResult => ({
  outcome,
  playlists,
  fileTrashed: false,
})

export async function removeDuplicateCopy(
  {
    removePid,
    keepPid,
    label,
    keepLabel,
  }: { removePid: string; keepPid: string; label: string; keepLabel: string },
  deps: RemoveCopyDeps,
): Promise<RemoveCopyResult> {
  if (removePid === keepPid) return none('failed')
  const answer = await deps.transferPlaylists(removePid, keepPid, label, keepLabel)
  if (answer === 'mismatch') return none('mismatch')
  if (answer === 'missing') return none('missing')
  const parsed = /^(\d+)\t(\d+)$/.exec(answer)
  if (!parsed) return none('failed')
  const playlists = Number(parsed[1])
  if (Number(parsed[2]) > 0) return none('playlist-failed', playlists)
  const [removeLoc, keepLoc] = await Promise.all([deps.locate(removePid), deps.locate(keepPid)])
  const maybeShared = await mayShareFile(removeLoc, keepLoc, deps)
  let location: string | null
  try {
    location = await deps.deleteEntry(removePid, label)
  } catch (e) {
    if (e instanceof Error && e.message === 'applemusic-delete-mismatch')
      return none('mismatch', playlists)
    throw e
  }
  if (location === null) return none('missing', playlists)
  if (!location) return { outcome: 'removed', playlists, fileTrashed: false }
  // The file is trashed later, once the DJ libraries have moved to the kept copy.
  return {
    outcome: 'removed',
    playlists,
    fileTrashed: false,
    pair: { from: location, to: keepLoc, shared: maybeShared },
  }
}
