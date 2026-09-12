import Database from 'better-sqlite3-multiple-ciphers'

// Reads the user's real rekordbox collection (master.db). rekordbox 6 and 7 keep it as
// SQLite encrypted with SQLCipher, so nothing here works without the three pragmas
// below, applied in this order and before the first statement.
//
// Why this module exists at all: converting an MP3 to WAV changes the file's extension,
// hence its path, and rekordbox indexes tracks by path — the converted track shows up
// with the missing-file "!" and has to be relocated by hand. Playlists, however, link a
// track by ID (djmdSongPlaylist.ContentID), never by path, so rewriting the path on the
// existing row keeps the track in every playlist it belongs to, with its cues and its
// history. That is the whole basis for repointing instead of re-importing.

// The same key for every installation; it depends on neither machine nor licence, and is
// published in the projects that document this format. Passed as PLAINTEXT: the driver
// also accepts a hex-bytes form (x'...'), which is silently wrong here and fails with
// "file is not a database" — the same error a corrupt file gives, so the mistake does not
// announce itself.
export const REKORDBOX_KEY = '402fd482c38817c35ffa8ffb8c7d93143b749e7d315df7a81732a1ff43608497'

export interface RekordboxTrack {
  id: string
  folderPath: string
  fileName: string
  fileType: number
  fileSize: number
}

// rekordbox stores the format as a number, verified against a real 1,962-track
// collection rather than taken from third-party notes, which list mp3 as "0 or 1".
export const FILE_TYPES: Record<string, number> = {
  mp3: 1,
  m4a: 4,
  flac: 5,
  wav: 11,
  aiff: 12,
  aif: 12,
}

// Streaming entries (Spotify and the like) live in djmdContent next to real files, but
// carry an identifier where the path goes and a size of zero. They have no file to
// repoint, so every lookup here excludes them rather than leaving each caller to
// remember.
const STREAMING_FILE_TYPE = 25

type RekordboxDb = InstanceType<typeof Database>

// Opens the collection read-write but touches nothing; callers that only read simply
// never write. Returns null instead of throwing for every reason the file may not be
// usable — absent, not a rekordbox database, a future cipher — because a user who does
// not run rekordbox is the normal case, not an error to report.
export function openRekordboxDb(path: string): RekordboxDb | null {
  let db: RekordboxDb
  try {
    db = new Database(path, { fileMustExist: true })
  } catch {
    return null
  }
  try {
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
    db.pragma(`key='${REKORDBOX_KEY}'`)
    // The pragmas above succeed even with the wrong key; the first real read is what
    // proves the file decrypted.
    db.prepare('SELECT count(*) FROM sqlite_master').get()
    return db
  } catch {
    db.close()
    return null
  }
}

// Finds the collection entry for a file Surco is about to replace. The comparison is
// case-insensitive because the path comes from Surco's own scan while the stored one
// comes from however rekordbox recorded it, and on both macOS and Windows the same file
// is reached by either spelling.
export function findTrackByPath(db: RekordboxDb, path: string): RekordboxTrack | null {
  const row = db
    .prepare(
      `SELECT ID, FolderPath, FileNameL, FileType, FileSize
         FROM djmdContent
        WHERE FolderPath = ? COLLATE NOCASE
          AND FileType <> ?
          AND (rb_local_deleted IS NULL OR rb_local_deleted = 0)
        LIMIT 1`,
    )
    .get(path, STREAMING_FILE_TYPE) as
    | { ID: string; FolderPath: string; FileNameL: string; FileType: number; FileSize: number }
    | undefined
  if (!row) return null
  return {
    id: String(row.ID),
    folderPath: row.FolderPath,
    fileName: row.FileNameL,
    fileType: row.FileType,
    fileSize: row.FileSize,
  }
}
