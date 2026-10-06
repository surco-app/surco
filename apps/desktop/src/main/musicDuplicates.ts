import type { RemoveCopyResult } from '../shared/types'

export interface RemoveCopyDeps {
  locate: (persistentId: string) => Promise<string>
  realpath: (path: string) => Promise<string | null>
  transferPlaylists: (fromPid: string, toPid: string, label: string) => Promise<string>
  deleteEntry: (persistentId: string, label: string) => Promise<string | null>
  trash: (path: string) => Promise<void>
}

async function sharesFile(a: string, b: string, deps: RemoveCopyDeps): Promise<boolean> {
  if (!a || !b) return false
  const [ra, rb] = await Promise.all([deps.realpath(a), deps.realpath(b)])
  return ra !== null && ra.normalize('NFC') === rb?.normalize('NFC')
}

export async function removeDuplicateCopy(
  { removePid, keepPid, label }: { removePid: string; keepPid: string; label: string },
  deps: RemoveCopyDeps,
): Promise<RemoveCopyResult> {
  const moved = await deps.transferPlaylists(removePid, keepPid, label)
  if (moved === 'mismatch') return { outcome: 'mismatch', playlists: 0, fileTrashed: false }
  if (moved === 'missing') return { outcome: 'missing', playlists: 0, fileTrashed: false }
  const playlists = Number(moved) || 0
  const [removeLoc, keepLoc] = await Promise.all([deps.locate(removePid), deps.locate(keepPid)])
  const shared = await sharesFile(removeLoc, keepLoc, deps)
  let location: string | null
  try {
    location = await deps.deleteEntry(removePid, label)
  } catch (e) {
    if (e instanceof Error && e.message === 'applemusic-delete-mismatch')
      return { outcome: 'mismatch', playlists, fileTrashed: false }
    throw e
  }
  if (location === null) return { outcome: 'missing', playlists, fileTrashed: false }
  if (!location || shared) return { outcome: 'removed', playlists, fileTrashed: false }
  await deps.trash(location)
  return { outcome: 'removed', playlists, fileTrashed: true }
}
