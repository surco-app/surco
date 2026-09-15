import { homedir } from 'node:os'
import Database from 'better-sqlite3-multiple-ciphers'
import log from 'electron-log/main'

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

// Two collection rows resolving to one file on disk. The user's library has 35 of these,
// because ~/Music/Music is a symlink to the volume they also reference directly, and 67
// of those rows are in playlists with differing FileSize — so the rows are not
// interchangeable and picking one silently would repoint half of the playlists and leave
// the other half on the replaced file. Which row to keep is a decision for the user.
export interface AmbiguousMatch {
  ambiguous: string[]
}

export function isAmbiguous(m: RekordboxTrack | AmbiguousMatch | null): m is AmbiguousMatch {
  return m !== null && 'ambiguous' in m
}

export interface FindOptions {
  // Resolves a stored path to where it really lands, so a track imported through a
  // symlink still matches the path Surco scanned. Injected rather than calling
  // realpathSync directly so the tests can describe the user's layout without creating
  // it, and so a broken or offline path falls back to the literal string.
  realPath?: (path: string) => string
  // The music folder inside the home directory, whose link target becomes a rewrite rule.
  // Overridable so tests need no such folder on the machine running them.
  homeMusicDir?: string
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

interface ContentRow {
  ID: string
  FolderPath: string
  FileNameL: string
  FileType: number
  FileSize: number
}

// The music folder inside the user's home is a symlink on this machine, pointing at the
// volume their collection also references directly. Both prefixes name the same files,
// and rekordbox stored whichever was used at import. Resolving the link once gives the
// rewrite rule that makes the two spellings comparable even for files that no longer
// exist, which per-path resolution cannot do. Any other symlink still resolves normally.
function linkPrefixes(options: FindOptions): [string, string][] {
  const resolve = options.realPath
  if (!resolve) return []
  const home = options.homeMusicDir ?? `${homedir()}/Music/Music`
  try {
    const target = resolve(home)
    if (target !== home) return [[home, target]]
  } catch {
    // No such folder, or not resolvable: there is no prefix rule to apply.
  }
  return []
}

// Resolving every stored path would mean thousands of filesystem calls, most of them on
// a network volume, so the rows are narrowed by file name first — indexed or not, that
// is one cheap comparison against a column rekordbox always fills — and only the handful
// that share the name get resolved and compared in full.
function candidateRows(db: RekordboxDb, fileName: string): ContentRow[] {
  return db
    .prepare(
      `SELECT ID, FolderPath, FileNameL, FileType, FileSize
         FROM djmdContent
        WHERE FileNameL = ? COLLATE NOCASE
          AND FileType <> ?
          AND (rb_local_deleted IS NULL OR rb_local_deleted = 0)`,
    )
    .all(fileName, STREAMING_FILE_TYPE) as ContentRow[]
}

// Finds the collection entry for a file Surco is about to replace.
//
// Matching is on the RESOLVED path, not the stored string: the user's ~/Music/Music is a
// symlink to the volume their collection also references directly, so 1513 of their
// tracks are recorded under one prefix and 413 under the other while both name the same
// files. Comparison is case-insensitive too, since Surco's scan and rekordbox's import
// can spell the same path differently on macOS and Windows.
//
// Returns the single matching track, null when the collection does not have it (the
// normal case for a partly-imported library), or an ambiguous verdict when more than one
// row resolves to the file — never a guess between them.
export function findTrackByPath(
  db: RekordboxDb,
  path: string,
  options: FindOptions = {},
): RekordboxTrack | AmbiguousMatch | null {
  const resolve = options.realPath ?? ((p: string) => p)
  // Resolution answers where a path really lands, but only while the file is still
  // there: 11 of the user's tracks are already gone and every one of their rows throws.
  // Falling back to the raw string then makes two rows for one missing file look like
  // two different files, so the pair stops reading as ambiguous and one gets picked —
  // the silent choice this refuses to make, surfacing exactly where the collection is
  // already broken. Mapping the known link prefixes keeps those rows comparable with no
  // filesystem involved, and resolution handles the links nobody declared.
  const prefixes = linkPrefixes(options)
  const safeResolve = (p: string): string => {
    let out = p
    try {
      out = resolve(p)
    } catch {
      // Unresolvable: keep the literal path and let the prefix rules below do the work.
    }
    for (const [from, to] of prefixes) {
      if (out.toLowerCase().startsWith(from.toLowerCase())) {
        out = to + out.slice(from.length)
        break
      }
    }
    return out.toLowerCase()
  }
  const target = safeResolve(path)
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const rows = candidateRows(db, fileName)
  const matches = rows.filter((r) => safeResolve(r.FolderPath) === target)
  // Logged on every miss, because a miss is indistinguishable from "the collection never
  // had this track" without it: the user hit "none of these tracks are in the collection"
  // for a song plainly in rekordbox, and three rounds of guessing followed. The name it
  // searched by, the resolved target and what each same-named row resolves to are the
  // three facts that separate a wrong filename from a wrong prefix from a real absence.
  if (matches.length === 0) {
    log.info(
      `rekordbox lookup miss: name=${JSON.stringify(fileName)} target=${JSON.stringify(target)} rows=${rows.length}` +
        rows.map((r) => ` | row ${r.ID} -> ${JSON.stringify(safeResolve(r.FolderPath))}`).join(''),
    )
    return null
  }
  if (matches.length > 1) return { ambiguous: matches.map((r) => String(r.ID)) }
  const row = matches[0]
  return {
    id: String(row.ID),
    folderPath: row.FolderPath,
    fileName: row.FileNameL,
    fileType: row.FileType,
    fileSize: row.FileSize,
  }
}
