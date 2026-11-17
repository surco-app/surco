import { type FindOptions, isAmbiguous, type openRekordboxDb, trackFinder } from './rekordboxDb'
import { trackPlaylists } from './rekordboxPlaylistEdit'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

export function readMembership(
  db: Db,
  paths: string[],
  find: FindOptions,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const trackOf = trackFinder(db, { ...find, quiet: true })
  for (const path of paths) {
    const match = trackOf(path)
    if (match === null || isAmbiguous(match)) continue
    out[path] = trackPlaylists(db, match.id)
  }
  return out
}
