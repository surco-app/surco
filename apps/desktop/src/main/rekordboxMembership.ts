import { type FindOptions, findTrackByPath, isAmbiguous, type openRekordboxDb } from './rekordboxDb'
import { trackPlaylists } from './rekordboxPlaylistEdit'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

export function readMembership(
  db: Db,
  paths: string[],
  find: FindOptions,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    const match = findTrackByPath(db, path, { ...find, quiet: true })
    if (match === null || isAmbiguous(match)) continue
    out[path] = trackPlaylists(db, match.id)
  }
  return out
}
