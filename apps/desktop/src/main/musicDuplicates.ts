import type { ListMusicStep, ListRemoval, RemoveCopyResult } from '../shared/types'
import type { Activity } from './activity'

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
export async function mayShareFile(
  a: string,
  b: string,
  deps: Pick<RemoveCopyDeps, 'realpath'>,
): Promise<boolean> {
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

export interface RemoveCopyLog {
  track: Activity['track']
  // Where the file's fate is logged later, once the DJ libraries have moved.
  rememberCopy: (path: string, copy: { group: string; label: string }) => void
}

const STAYED: Record<Exclude<RemoveCopyResult['outcome'], 'removed'>, Ending> = {
  mismatch: { detailKey: 'activity.reviewDuplicateMismatch', status: 'warn' },
  missing: { detailKey: 'activity.reviewDuplicateMissing', status: 'warn' },
  'playlist-failed': { detailKey: 'activity.reviewDuplicatePlaylistFailed', status: 'error' },
  failed: { detailKey: 'activity.reviewDuplicateFailed', status: 'error' },
}

type Ending = {
  detailKey: string
  detailParams?: { count: number }
  status?: 'warn' | 'error'
}

function endingOf(result: RemoveCopyResult): Ending {
  if (result.outcome !== 'removed') return STAYED[result.outcome]
  return {
    detailKey: result.pair
      ? 'activity.reviewDuplicateRemoved'
      : 'activity.reviewDuplicateRemovedNoFile',
    detailParams: { count: result.playlists },
  }
}

// One Activity row per removed copy, titled by the copy the user saw; its file's fate joins
// the same row later.
export async function removeDuplicateCopyLogged(
  req: { removePid: string; keepPid: string; label: string; keepLabel: string },
  deps: RemoveCopyDeps,
  log: RemoveCopyLog,
): Promise<RemoveCopyResult> {
  const group = `duplicate-${req.removePid}`
  const result = await log.track(
    'applemusic',
    'activity.reviewDuplicateMusic',
    () => removeDuplicateCopy(req, deps),
    { group, groupLabel: req.label, summary: endingOf },
  )
  if (result.pair) log.rememberCopy(result.pair.from, { group, label: req.label })
  return result
}

// The list review found each entry by its file, so every live check names that file too.
export interface ListMusicDeps {
  transferPlaylists: (
    fromPid: string,
    toPid: string,
    label: string,
    keepLabel: string,
    locations: { from: string; to: string },
  ) => Promise<string>
  deleteEntry: (persistentId: string, label: string, location: string) => Promise<string | null>
}

// The list review's half of a removal in Music, run only once the file is really leaving.
// Fails closed like removeDuplicateCopy: no transfer target, two entries on one file or any
// doubt about the playlists leaves the entry, and the caller keeps the file.
export async function removeListCopyFromMusic(
  { from, to, music }: ListRemoval,
  deps: ListMusicDeps,
): Promise<ListMusicStep> {
  if (music === undefined) return 'none'
  if (music === 'ambiguous') return 'ambiguous'
  if (!music.keep) return 'kept-no-entry'
  if (music.keep.persistentId === music.removePid) return 'failed'
  const answer = await deps.transferPlaylists(
    music.removePid,
    music.keep.persistentId,
    music.label,
    music.keep.label,
    { from, to },
  )
  if (answer === 'mismatch') return 'mismatch'
  const parsed = /^(\d+)\t(\d+)$/.exec(answer)
  if (!parsed || Number(parsed[2]) > 0) return 'failed'
  let location: string | null
  try {
    location = await deps.deleteEntry(music.removePid, music.label, from)
  } catch (e) {
    if (e instanceof Error && e.message === 'applemusic-delete-mismatch') return 'mismatch'
    throw e
  }
  return location === null ? 'failed' : 'removed'
}
