import type { SourceNode } from '../shared/types'
import { type openRekordboxDb, STREAMING_FILE_TYPE } from './rekordboxDb'
import { IS_SEPARATOR, LIVE_LINK, readRekordboxTree } from './rekordboxPlaylists'

// What the USB export takes from master.db: the ticked playlists (a ticked folder means all
// of it), each track once, with everything baken's XML carries and the paths of rekordbox's
// own analysis and artwork. Read-only like every other reader of the collection; the caller
// opens it with { readonly: true }, which works with rekordbox open.

type RekordboxDb = NonNullable<ReturnType<typeof openRekordboxDb>>

export interface ExportCue {
  inMs: number
  outMs: number
  kind: number
  comment: string
}

export interface ExportTrack {
  id: string
  path: string
  title: string
  artist: string
  album: string
  genre: string
  label: string
  remixer: string
  composer: string
  mix: string
  key: string
  fileType: number
  lengthSec: number
  bpm: number
  bitRate: number
  sampleRate: number
  bitDepth: number
  rating: number
  year: number
  trackNo: number
  discNo: number
  dateAdded: string
  playCount: number
  comment: string
  analysisPath: string
  imagePath: string
  separator: boolean
  streaming: boolean
  cues: ExportCue[]
}

export interface ExportPlaylist {
  id: string
  name: string
  folders: string[]
  // Master IDs of the same folders, outermost first: the stick's sync file names them.
  folderIds: string[]
  // djmdPlaylist.updated_at in ms, the sync file's stamp for a playlist masterPlaylists6.xml
  // does not have yet.
  updatedAt: number
  trackIds: string[]
}

export interface ExportSelection {
  playlists: ExportPlaylist[]
  tracks: ExportTrack[]
}

export function selectedPlaylists(
  tree: SourceNode[],
  ids: ReadonlySet<string>,
): { node: SourceNode; folders: string[]; folderIds: string[] }[] {
  const out: { node: SourceNode; folders: string[]; folderIds: string[] }[] = []
  const walk = (
    nodes: SourceNode[],
    folders: string[],
    folderIds: string[],
    inside: boolean,
  ): void => {
    for (const n of nodes) {
      const on = inside || ids.has(n.id)
      if (n.kind === 'folder')
        walk(n.children ?? [], [...folders, n.name], [...folderIds, n.id], on)
      else if (on) out.push({ node: n, folders, folderIds })
    }
  }
  walk(tree, [], [], false)
  return out
}

// rekordbox 7 stamps every row '2026-10-15 18:00:00.000 +00:00' (all 95 playlists of
// Vicent's collection, 19/10); dropping the two spaces makes it ISO 8601, which every
// engine parses the same.
function rekordboxStampMs(stamp: string): number {
  return Date.parse(stamp.replace(' ', 'T').replace(' ', '')) || 0
}

interface Row {
  ID: string
  FolderPath: string
  Title: string | null
  artist: string | null
  album: string | null
  genre: string | null
  label: string | null
  remixer: string | null
  composer: string | null
  Subtitle: string | null
  ScaleName: string | null
  FileType: number
  Length: number | null
  BPM: number | null
  BitRate: number | null
  SampleRate: number | null
  BitDepth: number | null
  Rating: number | null
  ReleaseYear: number | null
  TrackNo: number | null
  DiscNo: number | null
  DateCreated: string | null
  DJPlayCount: number | string | null
  Commnt: string | null
  AnalysisDataPath: string | null
  ImagePath: string | null
  sep: number
}

const TRACKS_OF = `
  SELECT c.ID, c.FolderPath, c.Title, a.Name AS artist, al.Name AS album, g.Name AS genre,
         l.Name AS label, r.Name AS remixer, cp.Name AS composer, c.Subtitle, k.ScaleName,
         c.FileType, c.Length, c.BPM, c.BitRate, c.SampleRate, c.BitDepth, c.Rating,
         c.ReleaseYear, c.TrackNo, c.DiscNo, c.DateCreated, c.DJPlayCount, c.Commnt,
         c.AnalysisDataPath, c.ImagePath, ${IS_SEPARATOR} AS sep
    FROM djmdSongPlaylist s
    JOIN djmdContent c ON c.ID = s.ContentID
    LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
    LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
    LEFT JOIN djmdGenre g ON g.ID = c.GenreID
    LEFT JOIN djmdLabel l ON l.ID = c.LabelID
    LEFT JOIN djmdArtist r ON r.ID = c.RemixerID
    LEFT JOIN djmdArtist cp ON cp.ID = c.ComposerID
    LEFT JOIN djmdKey k ON k.ID = c.KeyID
   WHERE s.PlaylistID = ? AND ${LIVE_LINK}
   ORDER BY s.TrackNo`

const text = (v: string | null): string => (v ?? '').trim()
const num = (v: number | string | null): number => Number(v) || 0

function trackOf(r: Row): ExportTrack {
  return {
    id: String(r.ID),
    path: r.FolderPath,
    title: text(r.Title),
    artist: text(r.artist),
    album: text(r.album),
    genre: text(r.genre),
    label: text(r.label),
    remixer: text(r.remixer),
    composer: text(r.composer),
    mix: text(r.Subtitle),
    key: text(r.ScaleName),
    fileType: r.FileType,
    lengthSec: num(r.Length),
    // rekordbox stores BPM ×100.
    bpm: num(r.BPM) / 100,
    bitRate: num(r.BitRate),
    sampleRate: num(r.SampleRate),
    bitDepth: num(r.BitDepth),
    rating: num(r.Rating),
    year: num(r.ReleaseYear),
    trackNo: num(r.TrackNo),
    discNo: num(r.DiscNo),
    dateAdded: text(r.DateCreated).slice(0, 10),
    playCount: num(r.DJPlayCount),
    comment: text(r.Commnt),
    analysisPath: text(r.AnalysisDataPath),
    imagePath: text(r.ImagePath),
    separator: r.sep === 1,
    streaming: r.FileType === STREAMING_FILE_TYPE,
    cues: [],
  }
}

// SQLite's default limit on bound parameters is far above a playlist, but a whole-collection
// export of thousands of tracks is not; chunks keep the IN list well inside it.
const CHUNK = 500

function readCues(db: RekordboxDb, tracks: Map<string, ExportTrack>): void {
  const ids = [...tracks.keys()]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK)
    const rows = db
      .prepare(
        `SELECT ContentID, InMsec, OutMsec, Kind, Comment FROM djmdCue
          WHERE ContentID IN (${part.map(() => '?').join(', ')})
            AND coalesce(rb_local_deleted, 0) = 0
          ORDER BY InMsec`,
      )
      .all(...part) as {
      ContentID: string
      InMsec: number
      OutMsec: number | null
      Kind: number
      Comment: string | null
    }[]
    for (const c of rows)
      tracks.get(String(c.ContentID))?.cues.push({
        inMs: c.InMsec,
        outMs: c.OutMsec ?? -1,
        kind: c.Kind,
        comment: text(c.Comment),
      })
  }
}

export function readExportSelection(db: RekordboxDb, ids: string[]): ExportSelection {
  const picked = selectedPlaylists(readRekordboxTree(db), new Set(ids))
  const tracks = new Map<string, ExportTrack>()
  const statement = db.prepare(TRACKS_OF)
  const stamp = db.prepare('SELECT updated_at FROM djmdPlaylist WHERE ID = ?')
  const playlists = picked.map(({ node, folders, folderIds }) => {
    const rows = statement.all(node.id) as Row[]
    for (const r of rows) if (!tracks.has(String(r.ID))) tracks.set(String(r.ID), trackOf(r))
    const updated = stamp.get(node.id) as { updated_at: string | null } | undefined
    return {
      id: node.id,
      name: node.name,
      folders,
      folderIds,
      updatedAt: rekordboxStampMs(updated?.updated_at ?? ''),
      trackIds: rows.map((r) => String(r.ID)),
    }
  })
  readCues(db, tracks)
  return { playlists, tracks: [...tracks.values()] }
}
