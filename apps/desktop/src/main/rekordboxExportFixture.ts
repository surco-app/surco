import Database from 'better-sqlite3-multiple-ciphers'
import { REKORDBOX_KEY } from './rekordboxDb'
import { type PlaylistFixture, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

// The playlist fixture plus what the USB export reads: the name tables, the djmdContent
// columns baken's XML carries, and djmdCue. Column names as measured on rekordbox 7.2.19
// (docs/export-usb-medidas.md). Added on top rather than folded into the shared fixture so
// the organising tests keep the minimal schema they were written against. The identity
// tables (djmdProperty, djmdCloudProperty, djmdMyTag) are what the stick's identity reads.
export interface ContentDetails {
  ArtistID?: string
  AlbumID?: string
  GenreID?: string
  LabelID?: string
  RemixerID?: string
  ComposerID?: string
  Subtitle?: string
  BitRate?: number
  SampleRate?: number
  BitDepth?: number
  ReleaseYear?: number
  TrackNo?: number
  DiscNo?: number
  DateCreated?: string
  DJPlayCount?: number
  Commnt?: string
  AnalysisDataPath?: string
  ImagePath?: string
}

interface Named {
  ID: string
  Name: string
}

export interface FixtureNames {
  artists?: Named[]
  albums?: Named[]
  genres?: Named[]
  labels?: Named[]
}

export interface FixtureCue {
  ContentID: string
  InMsec: number
  OutMsec: number
  Kind: number
  Comment?: string
  deleted?: boolean
}

export interface FixtureMyTag {
  ID: string
  Seq: number
  Name: string
  Attribute: number
  ParentID: string
  deleted?: boolean
}

export interface ExportFixture extends PlaylistFixture {
  details?: Record<string, ContentDetails>
  names?: FixtureNames
  cues?: FixtureCue[]
  // djmdProperty.DBID, a single row in rekordbox 7.2.19, stored as text.
  dbId?: string
  cloudProperties?: { ID: string; Reserved1: string; Reserved2: string }[]
  myTags?: FixtureMyTag[]
}

const DETAIL_COLUMNS: [keyof ContentDetails, string][] = [
  ['ArtistID', 'VARCHAR(255)'],
  ['AlbumID', 'VARCHAR(255)'],
  ['GenreID', 'VARCHAR(255)'],
  ['LabelID', 'VARCHAR(255)'],
  ['RemixerID', 'VARCHAR(255)'],
  ['ComposerID', 'VARCHAR(255)'],
  ['Subtitle', 'VARCHAR(255)'],
  ['BitRate', 'INTEGER'],
  ['SampleRate', 'INTEGER'],
  ['BitDepth', 'INTEGER'],
  ['ReleaseYear', 'INTEGER'],
  ['TrackNo', 'INTEGER'],
  ['DiscNo', 'INTEGER'],
  ['DateCreated', 'VARCHAR(255)'],
  ['DJPlayCount', 'INTEGER'],
  ['Commnt', 'TEXT'],
  ['AnalysisDataPath', 'VARCHAR(255)'],
  ['ImagePath', 'VARCHAR(255)'],
]

export function writeRekordboxExportFixture(path: string, data: ExportFixture): void {
  writeRekordboxPlaylistFixture(path, data)
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  for (const [name, type] of DETAIL_COLUMNS)
    db.exec(`ALTER TABLE djmdContent ADD COLUMN ${name} ${type}`)
  db.exec(`
    CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255));
    CREATE TABLE djmdCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255), InMsec INTEGER,
      OutMsec INTEGER, Kind INTEGER, Comment TEXT, Color INTEGER DEFAULT -1,
      ColorTableIndex INTEGER, rb_local_deleted INTEGER DEFAULT 0);
    CREATE TABLE djmdProperty (DBID VARCHAR(255) PRIMARY KEY);
    CREATE TABLE djmdCloudProperty (ID VARCHAR(255) PRIMARY KEY, Reserved1 TEXT, Reserved2 TEXT);
    CREATE TABLE djmdMyTag (ID VARCHAR(255) PRIMARY KEY, Seq INTEGER, Name VARCHAR(255),
      Attribute INTEGER, ParentID VARCHAR(255), rb_local_deleted TINYINT(1) DEFAULT 0);
  `)
  if (data.dbId) db.prepare('INSERT INTO djmdProperty (DBID) VALUES (?)').run(data.dbId)
  const cloud = db.prepare(
    'INSERT INTO djmdCloudProperty (ID, Reserved1, Reserved2) VALUES (?, ?, ?)',
  )
  for (const c of data.cloudProperties ?? []) cloud.run(c.ID, c.Reserved1, c.Reserved2)
  const tag = db.prepare(
    `INSERT INTO djmdMyTag (ID, Seq, Name, Attribute, ParentID, rb_local_deleted)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  for (const t of data.myTags ?? [])
    tag.run(t.ID, t.Seq, t.Name, t.Attribute, t.ParentID, t.deleted ? 1 : 0)
  const tables: [keyof FixtureNames, string][] = [
    ['artists', 'djmdArtist'],
    ['albums', 'djmdAlbum'],
    ['genres', 'djmdGenre'],
    ['labels', 'djmdLabel'],
  ]
  for (const [key, table] of tables) {
    const insert = db.prepare(`INSERT INTO ${table} (ID, Name) VALUES (?, ?)`)
    for (const n of data.names?.[key] ?? []) insert.run(n.ID, n.Name)
  }
  for (const [id, details] of Object.entries(data.details ?? {})) {
    const entries = Object.entries(details)
    if (entries.length === 0) continue
    db.prepare(
      `UPDATE djmdContent SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE ID = ?`,
    ).run(...entries.map(([, v]) => v), id)
  }
  const cue = db.prepare(
    `INSERT INTO djmdCue (ID, ContentID, InMsec, OutMsec, Kind, Comment, rb_local_deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const [i, c] of (data.cues ?? []).entries()) {
    cue.run(
      `cue-${i}`,
      c.ContentID,
      c.InMsec,
      c.OutMsec,
      c.Kind,
      c.Comment ?? '',
      c.deleted ? 1 : 0,
    )
  }
  db.close()
}
