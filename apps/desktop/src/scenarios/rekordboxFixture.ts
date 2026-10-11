import { mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { openRekordboxDb, REKORDBOX_KEY } from '../main/rekordboxDb'

const LOOKUP = `UUID VARCHAR(255), rb_data_status INTEGER, rb_local_data_status INTEGER,
  rb_local_deleted TINYINT(1), rb_local_synced TINYINT(1), usn BIGINT, rb_local_usn BIGINT,
  created_at DATETIME, updated_at DATETIME`

export interface RekordboxSeed {
  id: string
  path: string
  title: string
  artist: string
  fileType: number
  genre?: string
  bpm?: number
  keyId?: string
  playlists?: string[]
  cuesMs?: number[]
}

export interface RekordboxRow {
  path: string
  fileType: number
  title: string
  artist: string | null
  album: string | null
  label: string | null
  genre: string | null
  comment: string | null
  year: number | null
  bpm: number | null
  keyId: string | null
  playlists: string[]
  cuesMs: number[]
}

export function makeRekordbox(dir: string, tracks: RekordboxSeed[]): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'master.db')
  const db = new Database(path)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (ID VARCHAR(255) PRIMARY KEY, FolderPath VARCHAR(255),
    FileNameL VARCHAR(255), FileNameS VARCHAR(255), FileType INTEGER, FileSize INTEGER,
    OrgFolderPath VARCHAR(255), Title VARCHAR(255), ArtistID VARCHAR(255), AlbumID VARCHAR(255),
    GenreID VARCHAR(255), LabelID VARCHAR(255), RemixerID VARCHAR(255), Commnt TEXT,
    ReleaseYear INTEGER, TrackNo INTEGER, DiscNo INTEGER, BPM INTEGER, KeyID VARCHAR(255),
    Rating INTEGER, ImagePath VARCHAR(255), usn BIGINT, rb_local_usn BIGINT,
    rb_local_deleted TINYINT(1) DEFAULT 0, updated_at DATETIME)`)
  db.exec(`CREATE TABLE djmdSongPlaylist (ID VARCHAR(255) PRIMARY KEY, PlaylistID VARCHAR(255),
    ContentID VARCHAR(255))`)
  db.exec(`CREATE TABLE djmdCue (ID VARCHAR(255) PRIMARY KEY, ContentID VARCHAR(255),
    InMsec INTEGER)`)
  db.exec(`CREATE TABLE djmdArtist (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
    SearchStr VARCHAR(255), ${LOOKUP})`)
  db.exec(`CREATE TABLE djmdAlbum (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255),
    AlbumArtistID VARCHAR(255), ImagePath VARCHAR(255), Compilation INTEGER,
    SearchStr VARCHAR(255), ${LOOKUP})`)
  db.exec(`CREATE TABLE djmdGenre (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP})`)
  db.exec(`CREATE TABLE djmdLabel (ID VARCHAR(255) PRIMARY KEY, Name VARCHAR(255), ${LOOKUP})`)
  db.exec(`CREATE TABLE agentRegistry (registry_id VARCHAR(255), int_1 BIGINT,
    updated_at DATETIME)`)
  db.prepare(`INSERT INTO agentRegistry VALUES ('localUpdateCount', 1000, NULL)`).run()
  for (const t of tracks) {
    const artistId = `artist-${t.id}`
    db.prepare(`INSERT INTO djmdArtist (ID, Name, rb_local_deleted) VALUES (?, ?, 0)`).run(
      artistId,
      t.artist,
    )
    const genreId = t.genre ? `genre-${t.id}` : null
    if (t.genre)
      db.prepare(`INSERT INTO djmdGenre (ID, Name, rb_local_deleted) VALUES (?, ?, 0)`).run(
        genreId,
        t.genre,
      )
    db.prepare(
      `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, Title, ArtistID,
       BPM, KeyID, GenreID) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    ).run(
      t.id,
      t.path,
      basename(t.path),
      t.fileType,
      t.title,
      artistId,
      t.bpm ?? null,
      t.keyId ?? null,
      genreId,
    )
    for (const [i, playlist] of (t.playlists ?? []).entries())
      db.prepare(`INSERT INTO djmdSongPlaylist VALUES (?, ?, ?)`).run(
        `${t.id}-pl${i}`,
        playlist,
        t.id,
      )
    for (const [i, ms] of (t.cuesMs ?? []).entries())
      db.prepare(`INSERT INTO djmdCue VALUES (?, ?, ?)`).run(`${t.id}-cue${i}`, t.id, ms)
  }
  db.close()
  return path
}

export function rekordboxRow(dbPath: string, id: string): RekordboxRow {
  const db = openRekordboxDb(dbPath)
  if (!db) throw new Error(`scenario: could not reopen ${dbPath}`)
  try {
    const row = db
      .prepare(
        `SELECT c.FolderPath AS path, c.FileType AS fileType, c.Title AS title,
         ar.Name AS artist, al.Name AS album, lb.Name AS label, gn.Name AS genre,
         c.Commnt AS comment, c.ReleaseYear AS year, c.BPM AS bpm, c.KeyID AS keyId
         FROM djmdContent c
         LEFT JOIN djmdArtist ar ON ar.ID = c.ArtistID
         LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
         LEFT JOIN djmdLabel lb ON lb.ID = c.LabelID
         LEFT JOIN djmdGenre gn ON gn.ID = c.GenreID
         WHERE c.ID = ?`,
      )
      .get(id) as Omit<RekordboxRow, 'playlists' | 'cuesMs'>
    const playlists = (
      db.prepare(`SELECT PlaylistID FROM djmdSongPlaylist WHERE ContentID = ?`).all(id) as {
        PlaylistID: string
      }[]
    ).map((r) => r.PlaylistID)
    const cuesMs = (
      db.prepare(`SELECT InMsec FROM djmdCue WHERE ContentID = ?`).all(id) as { InMsec: number }[]
    ).map((r) => r.InMsec)
    return { ...row, playlists, cuesMs }
  } finally {
    db.close()
  }
}
