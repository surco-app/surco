import type { AppleMusicTrackMeta, SourceNode, SourcePlaylistEntry } from '../shared/types'
import type { openRekordboxDb } from './rekordboxDb'

// Reads the user's rekordbox playlists as a source of tracks: the folder tree and one
// playlist's rows. Read-only by construction — every caller opens the collection with
// { readonly: true } — so browsing can never be what damages a collection.

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

// Same streaming marker rekordboxDb.ts excludes from lookups.
const STREAMING_FILE_TYPE = 25

// A separator is recognised by what it is, not where it lives: the user's is a blank
// 1 s MP3 under PioneerDJ/Imported from Device, linked 345 times, and another DJ's will
// sit anywhere. Length is in whole seconds.
const IS_SEPARATOR = `(c.Length <= 2 AND trim(coalesce(c.Title, '')) = '')`
const LIVE_LINK = `coalesce(s.rb_local_deleted, 0) = 0 AND coalesce(c.rb_local_deleted, 0) = 0`

interface PlaylistRow {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  n: number
}

export function readRekordboxTree(db: RekordboxDb): SourceNode[] {
  // Distinct tracks, not links: a track linked twice in one playlist is one row in the
  // list, and a count the list never reaches reads as missing tracks. Streaming rows are
  // still counted (the open toast announces them), and two content rows for one file
  // still count twice; neither can be told apart here without the disk.
  const rows = db
    .prepare(
      `SELECT p.ID, p.Name, p.Attribute, p.ParentID,
              (SELECT count(DISTINCT c.ID) FROM djmdSongPlaylist s JOIN djmdContent c ON c.ID = s.ContentID
                WHERE s.PlaylistID = p.ID AND ${LIVE_LINK} AND NOT ${IS_SEPARATOR}) AS n
         FROM djmdPlaylist p
        WHERE coalesce(p.rb_local_deleted, 0) = 0 AND p.Attribute IN (0, 1)
        ORDER BY p.Seq`,
    )
    .all() as PlaylistRow[]
  const byParent = new Map<string, PlaylistRow[]>()
  for (const r of rows) {
    const siblings = byParent.get(String(r.ParentID)) ?? []
    siblings.push(r)
    byParent.set(String(r.ParentID), siblings)
  }
  const build = (parent: string): SourceNode[] =>
    (byParent.get(parent) ?? []).map((r) => {
      if (r.Attribute === 1) {
        const children = build(String(r.ID))
        return { id: String(r.ID), name: r.Name, kind: 'folder', count: children.length, children }
      }
      return { id: String(r.ID), name: r.Name, kind: 'playlist', count: r.n }
    })
  return build('root')
}

interface EntryRow {
  FolderPath: string
  FileType: number
  BPM: number | null
  Rating: number | null
  ScaleName: string | null
  sep: number
}

// rekordbox stores BPM ×100 (13807 is 138.07). Trailing zeros are dropped so a whole
// tempo reads "150", the way Surco's own bpm field holds it.
function bpmText(raw: number | null): string | undefined {
  return raw && raw > 0 ? String(Number((raw / 100).toFixed(2))) : undefined
}

function metaOf(row: EntryRow): AppleMusicTrackMeta {
  const meta: AppleMusicTrackMeta = {}
  const bpm = bpmText(row.BPM)
  if (bpm) meta.bpm = bpm
  if (row.ScaleName?.trim()) meta.key = row.ScaleName.trim()
  // 0..5 stars in rekordbox; the shared shape uses Music's 0..100 so one fill rule serves
  // both sources.
  if (row.Rating && row.Rating > 0) meta.rating = row.Rating * 20
  return meta
}

export function readRekordboxPlaylist(db: RekordboxDb, id: string): SourcePlaylistEntry[] {
  const rows = db
    .prepare(
      `SELECT c.FolderPath, c.FileType, c.BPM, c.Rating, k.ScaleName, ${IS_SEPARATOR} AS sep
         FROM djmdSongPlaylist s
         JOIN djmdContent c ON c.ID = s.ContentID
         LEFT JOIN djmdKey k ON k.ID = c.KeyID
        WHERE s.PlaylistID = ? AND ${LIVE_LINK}
        ORDER BY s.TrackNo`,
    )
    .all(id) as EntryRow[]
  return rows.map((row) => {
    if (row.sep) return { path: row.FolderPath, separator: true, meta: {} }
    if (row.FileType === STREAMING_FILE_TYPE) return { path: null, separator: false, meta: {} }
    return { path: row.FolderPath, separator: false, meta: metaOf(row) }
  })
}
