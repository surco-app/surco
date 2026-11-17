import {
  type FindOptions,
  isAmbiguous,
  type openRekordboxDb,
  type TrackFinder,
  trackFinder,
} from './rekordboxDb'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

export interface MembershipSnapshot {
  trackOf: TrackFinder
  playlistsOf: Map<string, string[]>
  answered: Map<string, string[] | null>
}

export function membershipSnapshot(db: Db): MembershipSnapshot {
  const playlistsOf = new Map<string, string[]>()
  const links = db
    .prepare(
      `SELECT DISTINCT s.ContentID AS contentId, p.ID AS playlistId
         FROM djmdSongPlaylist s JOIN djmdPlaylist p ON p.ID = s.PlaylistID
        WHERE coalesce(s.rb_local_deleted, 0) = 0
          AND coalesce(p.rb_local_deleted, 0) = 0 AND p.Attribute = 0`,
    )
    .all() as { contentId: string; playlistId: string }[]
  for (const link of links) {
    const contentId = String(link.contentId)
    const held = playlistsOf.get(contentId)
    if (held) held.push(String(link.playlistId))
    else playlistsOf.set(contentId, [String(link.playlistId)])
  }
  return { trackOf: trackFinder(db), playlistsOf, answered: new Map() }
}

export function membershipFrom(
  snapshot: MembershipSnapshot,
  paths: string[],
  find: FindOptions,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const path of paths) {
    let playlists = snapshot.answered.get(path)
    if (playlists === undefined) {
      const match = snapshot.trackOf(path, { ...find, quiet: true })
      playlists =
        match === null || isAmbiguous(match) ? null : (snapshot.playlistsOf.get(match.id) ?? [])
      snapshot.answered.set(path, playlists)
    }
    if (playlists) out[path] = playlists
  }
  return out
}

export function readMembership(
  db: Db,
  paths: string[],
  find: FindOptions,
): Record<string, string[]> {
  return membershipFrom(membershipSnapshot(db), paths, find)
}
