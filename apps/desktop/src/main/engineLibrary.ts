import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { Database } from 'sql.js'
import { starsTagToEngineRating } from '../shared/rating'
import type { AppleMusicLookupCandidate, Beatgrid, TrackMetadata } from '../shared/types'
import { engineBeatData } from './engineBeatData'
import {
  type EngineTrack,
  initEngineLibrary,
  lastId,
  loadSqlJs,
  TRACK_COLUMNS,
  trackRow,
} from './engine'
import { isEngineDjRunning } from './engineProcess'
import { probeDuration, probeProperties } from './ffmpeg'

// Registers converted files in the user's own Engine DJ library (the "Engine DJ"
// conversion destination), unlike engine.ts's export which always builds a fresh
// library in a folder the user picks. Writing into a real library the user depends on
// is what shapes everything here: the previous m.db is backed up before each write, a
// non-empty WAL (Engine DJ open) refuses the write instead of corrupting it, columns
// are intersected with the live schema so a library Engine 4.x migrated forward still
// accepts our rows, and an existing row for the same path is updated — never duplicated,
// and never stripped of the analysis Engine already stored on it.

// Reads the library's title/artist/duration triples for the "already owned" membership
// check — the Engine counterpart of the Apple Music library dump, sharing its candidate
// shape so the renderer matches both with the same index. Read-only (plain readFile, no
// locks), so it is safe while Engine DJ itself is open; a missing or unreadable database
// simply reports an empty library, leaving every row's verdict undefined.
export async function dumpEngineLibrary(libraryDir: string): Promise<AppleMusicLookupCandidate[]> {
  const SQL = await loadSqlJs()
  let db: Database
  try {
    db = new SQL.Database(await readFile(join(libraryDir, 'Database2', 'm.db')))
  } catch {
    return []
  }
  try {
    const result = db.exec('SELECT title, artist, length FROM Track')
    return (result[0]?.values ?? []).flatMap(([title, artist, length]) => {
      if (!title || !artist) return []
      return [
        {
          title: String(title),
          artist: String(artist),
          ...(typeof length === 'number' && { durationSec: length }),
        },
      ]
    })
  } catch {
    // A schema this query doesn't fit (some future Engine) degrades to "no verdicts",
    // never to a failed conversion pipeline.
    return []
  } finally {
    db.close()
  }
}

// The columns a re-converted file may change on an existing row. Deliberately
// metadata-only: isAnalyzed, length, cues and playlist memberships survive a
// re-export untouched — length is Engine's own analysis output (resolveTrack never
// knows it), so updating it could only ever null a value Engine derived, on a row
// Engine will not re-analyze. beatData is the one exception, joined at the call
// site only when this conversion actually carries a staged grid.
const UPDATE_COLUMNS = [
  'bpm',
  'year',
  'filename',
  'bpmAnalyzed',
  'fileBytes',
  'title',
  'artist',
  'album',
  'genre',
  'comment',
  'fileType',
  'rating',
]

// BPM columns Engine also fills from its own analysis: a tag that carries a BPM should
// update them, but a tag without one must not null out what Engine derived.
const KEEP_WHEN_NULL = new Set(['bpm', 'bpmAnalyzed'])

interface PendingAdd {
  libraryDir: string
  filePath: string
  meta: TrackMetadata
  playlist: string
  coverPath?: string
  // The staged beatgrid in output-file time (the caller already offset the trim).
  beatgrid?: Beatgrid
  resolve: () => void
  reject: (e: unknown) => void
}

// sql.js edits are whole-file rewrites (load bytes → mutate → export), so concurrent
// adds against one database would clobber each other. Adds queue here and a single
// drain loop writes them; everything queued while a write is in flight lands in the
// next one, so a parallel bulk conversion pays one read/write per burst, not per track.
let pending: PendingAdd[] = []
let draining = false

export function addToEngineLibrary(
  libraryDir: string,
  filePath: string,
  meta: TrackMetadata,
  playlist: string,
  coverPath?: string,
  beatgrid?: Beatgrid,
): Promise<void> {
  return new Promise((resolve, reject) => {
    pending.push({ libraryDir, filePath, meta, playlist, coverPath, beatgrid, resolve, reject })
    if (!draining) void drain()
  })
}

async function drain(): Promise<void> {
  draining = true
  try {
    while (pending.length) {
      const batch = pending
      pending = []
      // The library folder is a setting, so adds queued around a settings change may
      // target different libraries; group so each batch writes where it was aimed.
      const byDir = new Map<string, PendingAdd[]>()
      for (const add of batch) {
        byDir.set(add.libraryDir, [...(byDir.get(add.libraryDir) ?? []), add])
      }
      for (const [dir, adds] of byDir) {
        try {
          await writeBatch(dir, adds)
          for (const add of adds) add.resolve()
        } catch (e) {
          for (const add of adds) add.reject(e)
        }
      }
    }
  } finally {
    draining = false
  }
}

async function writeBatch(libraryDir: string, adds: PendingAdd[]): Promise<void> {
  const database2 = join(libraryDir, 'Database2')
  const dbPath = join(database2, 'm.db')
  // Engine DJ loads the library once at launch and never re-reads it, so a write under
  // a running Engine is invisible until restart at best — and whichever side saves
  // last wins at worst. The process check is the reliable guard; the non-empty WAL /
  // rollback-journal checks additionally catch a crashed session's unflushed writes.
  await assertEngineClosed(dbPath)
  const SQL = await loadSqlJs()
  let db: Database
  if ((await fileSize(dbPath)) >= 0) {
    // Keep the pre-write database around: this file is the user's real library, and a
    // backup next to it is the recovery path if a write ever goes wrong.
    await copyFile(dbPath, join(database2, 'm.db.surco-backup'))
    db = new SQL.Database(await readFile(dbPath))
  } else {
    await mkdir(database2, { recursive: true })
    db = new SQL.Database()
    initEngineLibrary(db)
  }
  try {
    // Intersect with the live Track columns: a library a newer Engine has migrated may
    // have added columns (left to their defaults) or dropped ones we would have set.
    const live = new Set(db.exec('PRAGMA table_info(Track)')[0].values.map((row) => String(row[1])))
    const epoch = Math.floor(Date.now() / 1000)
    const uuid = String(db.exec('SELECT uuid FROM Information')[0].values[0][0])
    // Path matching is normalization-aware: APFS treats NFC and NFD names as one file,
    // so a byte-exact SQL compare would insert a twin row for a path Engine (or a
    // browser download) stored in the other form. Compare NFC-to-NFC in JS instead.
    const existingByPath = new Map(
      (db.exec('SELECT id, path FROM Track')[0]?.values ?? []).map(([id, p]) => [
        String(p).normalize('NFC'),
        id as number,
      ]),
    )
    for (const add of adds) {
      const track = await resolveTrack(libraryDir, add)
      const row = new Map(TRACK_COLUMNS.map((c, i) => [c, trackRow(track, epoch)[i]]))
      const existingId = existingByPath.get(track.relativePath.normalize('NFC'))
      let trackId: number
      if (existingId !== undefined) {
        trackId = existingId
        // beatData joins the update only when this conversion carries a grid:
        // updating it unconditionally would null out grids Engine analyzed
        // itself on tracks the user never touched the Grid section for.
        const updatable = row.get('beatData')
          ? [...UPDATE_COLUMNS, 'beatData', 'isBeatGridLocked']
          : UPDATE_COLUMNS
        const cols = updatable.filter(
          (c) => live.has(c) && !(KEEP_WHEN_NULL.has(c) && row.get(c) == null),
        )
        db.run(`UPDATE Track SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [
          ...cols.map((c) => row.get(c) ?? null),
          trackId,
        ])
      } else {
        const cols = TRACK_COLUMNS.filter((c) => live.has(c))
        db.run(
          `INSERT INTO Track (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row.get(c) ?? null),
        )
        trackId = lastId(db)
        existingByPath.set(track.relativePath.normalize('NFC'), trackId)
      }
      // Engine renders artwork from its own AlbumArt blobs, never from the file's
      // tags, so the cover has to be stored here for the row to show any art.
      const artId = add.coverPath ? await ensureAlbumArt(db, add.coverPath) : null
      if (artId !== null) db.run('UPDATE Track SET albumArtId = ? WHERE id = ?', [artId, trackId])
      addToPlaylist(db, add.playlist, trackId, uuid)
    }
    // The guard above ran before the batch's reads (covers, file stats); Engine
    // launched in that window has loaded the pre-write library, and renaming over it
    // would set up the silent save-on-quit revert the guard exists to prevent. Check
    // again at the last moment so the vulnerable window shrinks from the whole batch
    // to the swap itself.
    await assertEngineClosed(dbPath)
    // Write-then-rename so a crash mid-write can never leave a truncated m.db behind.
    const tmp = `${dbPath}.surco-tmp`
    await writeFile(tmp, db.export())
    await rename(tmp, dbPath)
  } finally {
    db.close()
  }
}

// Stores the cover image as an AlbumArt row and returns its id, reusing an existing
// row for the same image (two tracks off one release share one blob). The hash keys
// the dedup; sha1-hex matches what Engine's own imports write. An unreadable cover
// returns null — the row then keeps whatever art reference it already had.
async function ensureAlbumArt(db: Database, coverPath: string): Promise<number | null> {
  let bytes: Buffer
  try {
    bytes = await readFile(coverPath)
  } catch {
    return null
  }
  const hash = createHash('sha1').update(bytes).digest('hex')
  const found = db.exec('SELECT id FROM AlbumArt WHERE hash = ?', [hash])
  if (found.length) return found[0].values[0][0] as number
  db.run('INSERT INTO AlbumArt (hash, albumArt) VALUES (?, ?)', [hash, new Uint8Array(bytes)])
  return lastId(db)
}

// Puts the track into the named root playlist — the DJ's "what Surco just converted"
// inbox — creating the playlist on first use. Membership is deduplicated, so a
// re-convert never lists the track twice.
function addToPlaylist(db: Database, title: string, trackId: number, uuid: string): void {
  const found = db.exec('SELECT id FROM Playlist WHERE title = ? AND parentListId = 0', [title])
  let listId: number
  if (found.length) {
    listId = found[0].values[0][0] as number
  } else {
    // Playlist dates are formatted strings (unlike Track dates, which are epoch seconds).
    // Inserting with nextListId = 0 appends at the sibling tail: the schema's
    // before/after-insert triggers rechain whichever root playlist used to end the list.
    const now = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    const lastEdit = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
    db.run(
      'INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, lastEditTime, isExplicitlyExported) VALUES (?, 0, 1, 0, ?, 1)',
      [title, lastEdit],
    )
    listId = lastId(db)
  }
  const member = db.exec(
    'SELECT id FROM PlaylistEntity WHERE listId = ? AND trackId = ? AND databaseUuid = ?',
    [listId, trackId, uuid],
  )
  if (member.length) return
  // PlaylistEntity is an intrusive forward-linked list (0 = tail): insert the new
  // entity as the tail, then point the previous tail at it so Engine reads the
  // playlist back in add order.
  db.run(
    'INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (?, ?, ?, 0, 0)',
    [listId, trackId, uuid],
  )
  const entityId = lastId(db)
  db.run(
    'UPDATE PlaylistEntity SET nextEntityId = ? WHERE listId = ? AND nextEntityId = 0 AND id <> ?',
    [entityId, listId, entityId],
  )
}

async function resolveTrack(libraryDir: string, add: PendingAdd): Promise<EngineTrack> {
  const bpm = Number.parseFloat(add.meta.bpm)
  const year = Number.parseInt(add.meta.year, 10)
  let fileBytes: number | null = null
  try {
    fileBytes = (await stat(add.filePath)).size
  } catch {
    // The conversion just wrote this file; losing a race here only loses the size.
  }
  return {
    // Engine stores the path relative to the Engine Library dir, forward-slashed.
    relativePath: relative(libraryDir, add.filePath).split('\\').join('/'),
    filename: basename(add.filePath),
    fileType: extname(add.filePath).slice(1).toLowerCase(),
    fileBytes,
    title: add.meta.title,
    artist: add.meta.artist,
    album: add.meta.album,
    genre: add.meta.genre,
    comment: add.meta.comment,
    bpm: Number.isFinite(bpm) ? Math.round(bpm) : null,
    bpmAnalyzed: Number.isFinite(bpm) ? bpm : null,
    year: Number.isFinite(year) ? year : null,
    // Unknown at conversion time; Engine fills the length when it analyzes the file.
    durationSec: null,
    rating: starsTagToEngineRating(add.meta.rating ?? ''),
    beatData: await resolveBeatData(add),
  }
}

// The staged grid as Engine's beatData blob, sized to the converted file the
// row points at. Best-effort like the cover: a failed probe only loses the
// grid, never the row.
async function resolveBeatData(add: PendingAdd): Promise<Uint8Array | undefined> {
  if (!add.beatgrid) return undefined
  try {
    const [props, durationSec] = await Promise.all([
      probeProperties(add.filePath),
      probeDuration(add.filePath),
    ])
    if (!(props.sampleRateHz > 0) || !durationSec || !(durationSec > 0)) return undefined
    return engineBeatData(
      add.beatgrid,
      props.sampleRateHz,
      Math.round(durationSec * props.sampleRateHz),
    )
  } catch {
    return undefined
  }
}

async function assertEngineClosed(dbPath: string): Promise<void> {
  if (
    (await isEngineDjRunning()) ||
    (await fileSize(`${dbPath}-wal`)) > 0 ||
    (await fileSize(`${dbPath}-journal`)) > 0
  ) {
    throw new Error('Cierra Engine DJ antes de convertir: tiene la biblioteca abierta.')
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}
