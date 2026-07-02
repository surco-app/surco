import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, relative } from 'node:path'
import type { Database } from 'sql.js'
import type { TrackMetadata } from '../shared/types'
import {
  type EngineTrack,
  initEngineLibrary,
  lastId,
  loadSqlJs,
  TRACK_COLUMNS,
  trackRow,
} from './engine'

// Registers converted files in the user's own Engine DJ library (the "Engine DJ"
// conversion destination), unlike engine.ts's export which always builds a fresh
// library in a folder the user picks. Writing into a real library the user depends on
// is what shapes everything here: the previous m.db is backed up before each write, a
// non-empty WAL (Engine DJ open) refuses the write instead of corrupting it, columns
// are intersected with the live schema so a library Engine 4.x migrated forward still
// accepts our rows, and an existing row for the same path is updated — never duplicated,
// and never stripped of the analysis Engine already stored on it.

// The columns a re-converted file may change on an existing row. Deliberately
// metadata-only: isAnalyzed, beat data, cues and playlist memberships survive a
// re-export untouched.
const UPDATE_COLUMNS = [
  'length',
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
]

interface PendingAdd {
  libraryDir: string
  filePath: string
  meta: TrackMetadata
  playlist: string
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
): Promise<void> {
  return new Promise((resolve, reject) => {
    pending.push({ libraryDir, filePath, meta, playlist, resolve, reject })
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
  // A non-empty WAL means Engine DJ has the database open with writes not yet folded
  // into m.db; rewriting the file underneath it would corrupt the DJ's library.
  if ((await fileSize(`${dbPath}-wal`)) > 0) {
    throw new Error('Cierra Engine DJ antes de convertir: tiene la biblioteca abierta.')
  }
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
    const live = new Set(
      db.exec('PRAGMA table_info(Track)')[0].values.map((row) => String(row[1])),
    )
    const epoch = Math.floor(Date.now() / 1000)
    const uuid = String(db.exec('SELECT uuid FROM Information')[0].values[0][0])
    for (const add of adds) {
      const track = await resolveTrack(libraryDir, add)
      const row = new Map(TRACK_COLUMNS.map((c, i) => [c, trackRow(track, epoch)[i]]))
      const existing = db.exec('SELECT id FROM Track WHERE path = ?', [track.relativePath])
      let trackId: number
      if (existing.length) {
        trackId = existing[0].values[0][0] as number
        const cols = UPDATE_COLUMNS.filter((c) => live.has(c))
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
      }
      addToPlaylist(db, add.playlist, trackId, uuid)
    }
    // Write-then-rename so a crash mid-write can never leave a truncated m.db behind.
    const tmp = `${dbPath}.surco-tmp`
    await writeFile(tmp, db.export())
    await rename(tmp, dbPath)
  } finally {
    db.close()
  }
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
  db.run('UPDATE PlaylistEntity SET nextEntityId = ? WHERE listId = ? AND nextEntityId = 0 AND id <> ?', [
    entityId,
    listId,
    entityId,
  ])
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
  }
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return -1
  }
}
