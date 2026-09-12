import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeAll, describe, expect, it } from 'vitest'
import { findTrackByPath, isAmbiguous, openRekordboxDb, REKORDBOX_KEY } from './rekordboxDb'

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
  {
    // Imported through ~/Music/Music, which is a symlink to the same volume Surco scans.
    ID: '400000001',
    FolderPath: '/Users/vicent/Music/Music/Linked/Through Link.mp3',
    FileNameL: 'Through Link.mp3',
    FileType: 1,
    FileSize: 9000000,
    OrgFolderPath: '',
  },
  // One file, two rows, one per prefix — and different sizes, as in the real collection.
  {
    ID: '500000001',
    FolderPath: '/Users/vicent/Music/Music/Twin/Both Ways.wav',
    FileNameL: 'Both Ways.wav',
    FileType: 11,
    FileSize: 78581448,
    OrgFolderPath: '',
  },
  {
    ID: '500000002',
    FolderPath: '/Volumes/Public/Music/Twin/Both Ways.wav',
    FileNameL: 'Both Ways.wav',
    FileType: 11,
    FileSize: 116951070,
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

// Narrows a lookup to the single-track case, so a test that means to assert on one match
// fails loudly if the code returns an ambiguous verdict instead of quietly reading
// undefined off it.
function single(found: ReturnType<typeof findTrackByPath>) {
  if (found === null || isAmbiguous(found)) throw new Error(`expected one track, got ${found}`)
  return found
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
    expect(row.c).toBe(6)
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
    expect(single(found).id).toBe('127110986')
    db.close()
  })

  // The user's own library reaches one volume two ways: ~/Music/Music is a symlink to
  // /Volumes/Public/Music, and rekordbox stored whichever path was used at import —
  // 1513 tracks under the link against 413 under the target. Surco scans the resolved
  // path, so comparing the strings alone misses every track imported through the link.
  it('finds a track stored under a symlinked path', () => {
    const db = open()
    const found = findTrackByPath(db, '/Volumes/Public/Music/Linked/Through Link.mp3', {
      realPath: (p) => p.replace('/Users/vicent/Music/Music/', '/Volumes/Public/Music/'),
    })
    expect(single(found).id).toBe('400000001')
    db.close()
  })

  // 35 files in the real collection have two rows, one per prefix, and 67 of those rows
  // sit in playlists — with differing FileSize, so they are not interchangeable copies.
  // Repointing one would leave its twin aimed at the file the conversion replaced: the
  // missing-file "!" this feature exists to remove, on half the playlists. Which row is
  // the right one is the user's call, so an ambiguous match refuses rather than guesses.
  it('refuses to choose when two rows point at one real file', () => {
    const db = open()
    const found = findTrackByPath(db, '/Volumes/Public/Music/Twin/Both Ways.wav', {
      realPath: (p) => p.replace('/Users/vicent/Music/Music/', '/Volumes/Public/Music/'),
    })
    expect(found).toEqual({ ambiguous: ['500000001', '500000002'] })
    db.close()
  })

  // Resolution fails for a file that is already gone — 11 of the user's tracks are in
  // that state and show the "!" in rekordbox today. Falling back to the literal strings
  // then makes the two prefixes look like different files, so the pair stops reading as
  // ambiguous and one row gets picked: the exact silent choice the ambiguity check
  // exists to prevent, reappearing precisely where the collection is already damaged.
  it('still refuses when the file is gone and paths cannot be resolved', () => {
    const db = open()
    const found = findTrackByPath(db, '/Volumes/Public/Music/Twin/Both Ways.wav', {
      // The link itself resolves — it is the tracks under it that no longer exist, which
      // is the real shape: the folder is fine, the files were deleted or renamed.
      realPath: (p) => {
        if (p === '/Users/vicent/Music/Music') return '/Volumes/Public/Music'
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
      homeMusicDir: '/Users/vicent/Music/Music',
    })
    expect(found).toEqual({ ambiguous: ['500000001', '500000002'] })
    db.close()
  })
})
