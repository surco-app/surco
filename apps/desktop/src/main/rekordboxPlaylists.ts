import { existsSync } from 'node:fs'
import path, { resolve } from 'node:path'
import { mediaUrl } from '../shared/media'
import type {
  AppleMusicTrackMeta,
  RowCue,
  SourceNode,
  SourcePlaylistEntry,
  SourcePreview,
} from '../shared/types'
import { insideShare } from './rekordboxArtwork'
import { type openRekordboxDb, STREAMING_FILE_TYPE } from './rekordboxDb'

// Reads the user's rekordbox playlists as a source of tracks: the folder tree and one
// playlist's rows. Read-only by construction — every caller opens the collection with
// { readonly: true } — so browsing can never be what damages a collection.

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

// A separator is recognised by what it is, not where it lives: the user's is a blank
// 1 s MP3 under PioneerDJ/Imported from Device, linked 345 times, and another DJ's will
// sit anywhere. Length is in whole seconds.
export const IS_SEPARATOR = `(c.Length <= 2 AND trim(coalesce(c.Title, '')) = '')`
export const LIVE_LINK = `coalesce(s.rb_local_deleted, 0) = 0 AND coalesce(c.rb_local_deleted, 0) = 0`

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

export interface EntryRow {
  linkId: string
  contentId: string
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

// The spelling a file dropped on Surco has on this platform: rekordbox on Windows stores
// C:/... and a drop arrives as C:\..., and the crate must see one file, not two. Composed
// vs decomposed names are left to the renderer's comparison, since NTFS, unlike macOS,
// would not open a decomposed name under its composed spelling. An empty path stays empty:
// normalised it becomes ".", the current folder, which the expand would walk. Symlinked
// prefixes are not resolved here, so a link and its target still read as two files.
export function entryPath(stored: string, impl: typeof path = path): string {
  return stored ? impl.normalize(stored) : stored
}

export function readRekordboxPlaylist(db: RekordboxDb, id: string): SourcePlaylistEntry[] {
  const rows = db
    .prepare(
      `SELECT s.ID AS linkId, c.ID AS contentId, c.FolderPath, c.FileType, c.BPM, c.Rating, k.ScaleName, ${IS_SEPARATOR} AS sep
         FROM djmdSongPlaylist s
         JOIN djmdContent c ON c.ID = s.ContentID
         LEFT JOIN djmdKey k ON k.ID = c.KeyID
        WHERE s.PlaylistID = ? AND ${LIVE_LINK}
        ORDER BY s.TrackNo`,
    )
    .all(id) as EntryRow[]
  return rows.map((row) => {
    const ids = { linkId: String(row.linkId), contentId: String(row.contentId) }
    if (row.sep) return { path: entryPath(row.FolderPath), separator: true, meta: {}, ...ids }
    if (row.FileType === STREAMING_FILE_TYPE)
      return { path: null, separator: false, meta: {}, ...ids }
    return { path: entryPath(row.FolderPath), separator: false, meta: metaOf(row), ...ids }
  })
}

interface PreviewRow {
  contentId: string
  Title: string | null
  Artist: string | null
  Length: number | null
  ImagePath: string | null
  AnalysisDataPath: string | null
}

interface CueRow {
  contentId: string
  InMsec: number
  Kind: number
}

const PLAYLIST_CONTENT = `SELECT s.ContentID FROM djmdSongPlaylist s
  WHERE s.PlaylistID = ? AND coalesce(s.rb_local_deleted, 0) = 0`

export function shareFile(share: string, stored: string | null): string | null {
  if (!stored) return null
  const file = resolve(share, `.${stored}`)
  return insideShare(share, file) ? file : null
}

export function coverFileOf(
  share: string,
  imagePath: string | null,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const full = shareFile(share, imagePath)
  if (!full) return null
  const medium = full.replace(/\.jpg$/i, '_m.jpg')
  if (medium !== full && exists(medium)) return medium
  return exists(full) ? full : null
}

export function readRekordboxPlaylistWithPreview(
  db: RekordboxDb,
  share: string,
  id: string,
  exists: (p: string) => boolean = existsSync,
): SourcePlaylistEntry[] {
  const entries = readRekordboxPlaylist(db, id)
  const rows = db
    .prepare(
      `SELECT c.ID AS contentId, c.Title, a.Name AS Artist, c.Length, c.ImagePath, c.AnalysisDataPath
         FROM djmdContent c LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
        WHERE c.ID IN (${PLAYLIST_CONTENT})`,
    )
    .all(id) as PreviewRow[]
  const cueRows = db
    .prepare(
      `SELECT ContentID AS contentId, InMsec, Kind FROM djmdCue
        WHERE coalesce(rb_local_deleted, 0) = 0 AND ContentID IN (${PLAYLIST_CONTENT})
        ORDER BY InMsec`,
    )
    .all(id) as CueRow[]
  const cues = new Map<string, RowCue[]>()
  for (const c of cueRows) {
    const list = cues.get(String(c.contentId)) ?? []
    list.push({ ms: c.InMsec, kind: c.Kind })
    cues.set(String(c.contentId), list)
  }
  const previews = new Map<string, SourcePreview>()
  for (const r of rows) {
    const cover = coverFileOf(share, r.ImagePath, exists)
    const analysis = shareFile(share, r.AnalysisDataPath)
    previews.set(String(r.contentId), {
      title: r.Title?.trim() ?? '',
      artist: r.Artist?.trim() ?? '',
      durationSec: r.Length ?? 0,
      ...(cover ? { coverUrl: mediaUrl(cover) } : {}),
      ...(analysis ? { analysisPath: analysis } : {}),
      cues: cues.get(String(r.contentId)) ?? [],
    })
  }
  return entries.map((e) => {
    const preview = e.contentId ? previews.get(e.contentId) : undefined
    return e.path && !e.separator && preview ? { ...e, preview } : e
  })
}
