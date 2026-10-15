import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'

// A miniature master.db with the tables and columns the playlist reader touches, encrypted
// like the real one. The column names come from a live rekordbox 7 collection; the shapes
// worth reproducing are the ones measured there: nested folders whose children repeat names,
// one blank separator file linked many times, a streaming row, soft-deleted rows, and the
// −128 cloud-sync trial playlist.
export interface FixtureContent {
  ID: string
  FolderPath: string
  FileType: number
  Title: string
  Length: number
  BPM?: number
  Rating?: number
  KeyID?: string
  deleted?: boolean
}

export interface FixturePlaylist {
  ID: string
  Name: string
  Attribute: number
  ParentID: string
  Seq: number
  deleted?: boolean
}

export interface FixtureLink {
  PlaylistID: string
  ContentID: string
  TrackNo: number
  // null writes a NULL flag, which rekordbox leaves on some rows instead of 0.
  deleted?: boolean | null
}

export interface PlaylistFixture {
  content: FixtureContent[]
  keys: { ID: string; ScaleName: string }[]
  playlists: FixturePlaylist[]
  links: FixtureLink[]
}

export function writeRekordboxPlaylistFixture(path: string, data: PlaylistFixture): void {
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`
    CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
      FileType INTEGER, Title VARCHAR(255), Length INTEGER, BPM INTEGER, Rating INTEGER,
      KeyID VARCHAR(255), rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdKey (ID VARCHAR(255) PRIMARY KEY, ScaleName VARCHAR(255));
    CREATE TABLE djmdPlaylist (ID VARCHAR(255) PRIMARY KEY, Seq INTEGER, Name VARCHAR(255),
      Attribute INTEGER, ParentID VARCHAR(255), rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255),
      ContentID VARCHAR(255), TrackNo INTEGER, rb_local_deleted INTEGER DEFAULT 0);
  `)
  const content = db.prepare('INSERT INTO djmdContent VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const c of data.content) {
    content.run(
      c.ID,
      c.FolderPath,
      c.FileType,
      c.Title,
      c.Length,
      c.BPM ?? 0,
      c.Rating ?? 0,
      c.KeyID ?? null,
      c.deleted ? 1 : 0,
    )
  }
  const key = db.prepare('INSERT INTO djmdKey VALUES (?, ?)')
  for (const k of data.keys) key.run(k.ID, k.ScaleName)
  const playlist = db.prepare('INSERT INTO djmdPlaylist VALUES (?, ?, ?, ?, ?, ?)')
  for (const p of data.playlists) {
    playlist.run(p.ID, p.Seq, p.Name, p.Attribute, p.ParentID, p.deleted ? 1 : 0)
  }
  const link = db.prepare('INSERT INTO djmdSongPlaylist VALUES (?, ?, ?, ?, ?)')
  data.links.forEach((l, i) => {
    link.run(
      `link-${i}`,
      l.PlaylistID,
      l.ContentID,
      l.TrackNo,
      l.deleted === null ? null : l.deleted ? 1 : 0,
    )
  })
  db.close()
}
