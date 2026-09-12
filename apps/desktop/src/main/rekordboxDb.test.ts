import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeAll, describe, expect, it } from 'vitest'
import { findTrackByPath, openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'

// A real master.db is 56 MB of the user's own collection and cannot live in the repo, so
// every test here builds a miniature one with the same encryption and the same column
// names taken from a live rekordbox 7 database. What it must reproduce faithfully is the
// part the code depends on: the SQLCipher settings, the path columns, and the fact that
// playlists reference a track by ID rather than by path.
let dbPath: string

const TRACKS = [
  {
    ID: '127110986',
    FolderPath: '/Volumes/Public/Music/Acid Tribute/02 Everybody.mp3',
    FileNameL: '02 Everybody.mp3',
    FileType: 1,
    FileSize: 18307141,
    // Set on tracks the user moved between volumes. rekordbox keeps running with this
    // stale, which is why nothing here may rewrite it.
    OrgFolderPath: '/Users/vicent/Music/Acid Tribute/02 Everybody.mp3',
  },
  {
    ID: '200000001',
    FolderPath: '/Volumes/Public/Music/Sylver/Forgiven.wav',
    FileNameL: 'Forgiven.wav',
    FileType: 11,
    FileSize: 52000000,
    OrgFolderPath: '',
  },
  {
    // A streaming track: no file on disk, an identifier where the path goes, size zero.
    // Repointing one is meaningless, so lookups must never return it.
    ID: '300000001',
    FolderPath: 'spotify:track:0OTO8ZF2YqFQVw9hnZylTd',
    FileNameL: 'spotify:track:0OTO8ZF2YqFQVw9hnZylTd',
    FileType: 25,
    FileSize: 0,
    OrgFolderPath: '',
  },
]

beforeAll(async () => {
  dbPath = join(await mkdtemp(join(tmpdir(), 'surco-rb-')), 'master.db')
  const db = new Database(dbPath)
  db.pragma(`cipher='sqlcipher'`)
  db.pragma('legacy=4')
  db.pragma(`key='${REKORDBOX_KEY}'`)
  db.exec(`CREATE TABLE djmdContent (
    ID VARCHAR(255) PRIMARY KEY,
    FolderPath VARCHAR(255),
    FileNameL VARCHAR(255),
    FileNameS VARCHAR(255),
    FileType INTEGER,
    FileSize INTEGER,
    OrgFolderPath VARCHAR(255),
    rb_LocalFolderPath VARCHAR(255),
    rb_local_deleted TINYINT(1) DEFAULT 0
  )`)
  db.exec(`CREATE TABLE djmdSongPlaylist (
    ID VARCHAR(255) PRIMARY KEY,
    PlaylistID VARCHAR(255),
    ContentID VARCHAR(255),
    TrackNo INTEGER
  )`)
  const insert = db.prepare(
    `INSERT INTO djmdContent (ID, FolderPath, FileNameL, FileType, FileSize, OrgFolderPath)
     VALUES (@ID, @FolderPath, @FileNameL, @FileType, @FileSize, @OrgFolderPath)`,
  )
  for (const t of TRACKS) insert.run(t)
  // The MP3 sits in two playlists, linked by ContentID.
  db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo) VALUES (?, ?, ?, ?)`,
  ).run('1', 'pl1', '127110986', 1)
  db.prepare(
    `INSERT INTO djmdSongPlaylist (ID, PlaylistID, ContentID, TrackNo) VALUES (?, ?, ?, ?)`,
  ).run('2', 'pl2', '127110986', 7)
  db.close()
})

// Opens the fixture and fails the test if it could not be decrypted, so each case below
// works with a real handle instead of asserting it away.
function open(): NonNullable<ReturnType<typeof openRekordboxDb>> {
  const db = openRekordboxDb(dbPath)
  if (!db) throw new Error('fixture did not decrypt')
  return db
}

describe('openRekordboxDb', () => {
  it('opens an encrypted rekordbox database', () => {
    const db = openRekordboxDb(dbPath)
    expect(db).not.toBeNull()
    db?.close()
  })

  // The key is passed as plaintext, not as hex bytes. Both forms are accepted by the
  // driver and only one decrypts, so a regression here would surface as "file is not a
  // database" — indistinguishable from a wrong key or a corrupt file.
  it('reads rows through the cipher rather than failing to decrypt', () => {
    const db = open()
    const row = db.prepare('SELECT count(*) c FROM djmdContent').get() as { c: number }
    expect(row.c).toBe(3)
    db?.close()
  })

  it('returns null for a file that is not a rekordbox database', async () => {
    const junk = join(await mkdtemp(join(tmpdir(), 'surco-rb-')), 'nope.db')
    const plain = new Database(junk)
    plain.exec('CREATE TABLE t (a)')
    plain.close()
    expect(openRekordboxDb(junk)).toBeNull()
  })

  it('returns null when the file does not exist', () => {
    expect(openRekordboxDb('/nonexistent/master.db')).toBeNull()
  })
})

describe('findTrackByPath', () => {
  it('finds the track that a conversion is about to replace', () => {
    const db = open()
    const found = findTrackByPath(db, '/Volumes/Public/Music/Acid Tribute/02 Everybody.mp3')
    expect(found).toEqual({
      id: '127110986',
      folderPath: '/Volumes/Public/Music/Acid Tribute/02 Everybody.mp3',
      fileName: '02 Everybody.mp3',
      fileType: 1,
      fileSize: 18307141,
    })
    db?.close()
  })

  // The normal case for a user who keeps only part of their library in rekordbox: no
  // match is an answer, not a failure.
  it('returns null when the collection does not have the track', () => {
    const db = open()
    expect(findTrackByPath(db, '/Volumes/Public/Music/Never/Imported.mp3')).toBeNull()
    db?.close()
  })

  // A streaming entry has an identifier where the path belongs. Returning one would let
  // a later write stamp a real file path onto a track that has no file.
  it('never returns a streaming track', () => {
    const db = open()
    expect(findTrackByPath(db, 'spotify:track:0OTO8ZF2YqFQVw9hnZylTd')).toBeNull()
    db?.close()
  })

  // macOS and Windows both treat the music volume case-insensitively in practice, and
  // the path Surco holds comes from its own scan rather than from rekordbox, so the two
  // spellings of the same file must resolve to one track.
  it('matches a path that differs only in case', () => {
    const db = open()
    const found = findTrackByPath(db, '/volumes/public/music/acid tribute/02 everybody.MP3')
    expect(found?.id).toBe('127110986')
    db?.close()
  })
})
