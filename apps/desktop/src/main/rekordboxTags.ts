import { randomInt, randomUUID } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import log from 'electron-log/main'
import type { LibraryTagUpdate, MusicReviewField, TagChange } from '../shared/types'
import type { LibraryRepointResult } from './libraryRepointFlush'
import { type FindOptions, findTrackByPath, isAmbiguous, openRekordboxDb } from './rekordboxDb'
import { isRekordboxRunning } from './rekordboxProcess'

type Db = NonNullable<ReturnType<typeof openRekordboxDb>>

const BACKUP_SUFFIX = '.surco-backup'
const LIVE = '(rb_local_deleted IS NULL OR rb_local_deleted = 0)'

interface Current {
  Title: string | null
  artist: string | null
  album: string | null
  AlbumArtistID: string | null
  albumArtist: string | null
  genre: string | null
}

const same = (a: string | null, b: string) => (a ?? '').normalize('NFC') === b.normalize('NFC')

// The format rekordbox writes itself: 2024-06-25 12:16:14.804 +00:00
export function stamp(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', ' +00:00')
}

// rekordbox reads rb_local_usn against this counter to know what changed locally.
export function nextUsn(db: Db): number {
  const row = db
    .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
    .get() as { int_1: number | null } | undefined
  const next = (row?.int_1 ?? 0) + 1
  db.prepare(`UPDATE agentRegistry SET int_1 = ? WHERE registry_id = 'localUpdateCount'`).run(next)
  return next
}

function freeId(db: Db, table: string): string {
  for (;;) {
    const id = String(randomInt(1, 2 ** 32 - 1))
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE ID = ?`).get(id)) return id
  }
}

function insertRow(db: Db, table: string, columns: Record<string, unknown>): string {
  const now = stamp()
  const row = {
    ID: freeId(db, table),
    ...columns,
    UUID: randomUUID(),
    rb_data_status: 0,
    rb_local_data_status: 0,
    rb_local_deleted: 0,
    rb_local_synced: 0,
    usn: null,
    rb_local_usn: nextUsn(db),
    created_at: now,
    updated_at: now,
  }
  const names = Object.keys(row)
  db.prepare(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  ).run(...Object.values(row))
  return row.ID
}

function artistId(db: Db, name: string): string {
  const row = db
    .prepare(`SELECT ID FROM djmdArtist WHERE Name = ? AND ${LIVE} LIMIT 1`)
    .get(name) as { ID: string } | undefined
  return row?.ID ?? insertRow(db, 'djmdArtist', { Name: name, SearchStr: null })
}

function genreId(db: Db, name: string): string {
  const row = db.prepare(`SELECT ID FROM djmdGenre WHERE Name = ? AND ${LIVE} LIMIT 1`).get(name) as
    | { ID: string }
    | undefined
  return row?.ID ?? insertRow(db, 'djmdGenre', { Name: name })
}

function albumId(db: Db, name: string, albumArtistId: string | null): string {
  const row = db
    .prepare(`SELECT ID FROM djmdAlbum WHERE Name = ? AND AlbumArtistID IS ? AND ${LIVE} LIMIT 1`)
    .get(name, albumArtistId) as { ID: string } | undefined
  return (
    row?.ID ??
    insertRow(db, 'djmdAlbum', {
      Name: name,
      AlbumArtistID: albumArtistId,
      ImagePath: null,
      Compilation: 0,
      SearchStr: null,
    })
  )
}

function currentOf(db: Db, id: string): Current {
  return db
    .prepare(
      `SELECT c.Title, a.Name AS artist, al.Name AS album, al.AlbumArtistID,
              aa.Name AS albumArtist, g.Name AS genre
         FROM djmdContent c
         LEFT JOIN djmdArtist a ON a.ID = c.ArtistID
         LEFT JOIN djmdAlbum al ON al.ID = c.AlbumID
         LEFT JOIN djmdArtist aa ON aa.ID = al.AlbumArtistID
         LEFT JOIN djmdGenre g ON g.ID = c.GenreID
        WHERE c.ID = ?`,
    )
    .get(id) as Current
}

type Fields = LibraryTagUpdate['fields']

// An album artist lives on the album row, so a track with no album has nowhere to keep it;
// creating a nameless album just to hold it would add junk to the collection.
function effectiveFields(fields: Fields, current: Current): Fields {
  if (fields.albumArtist && !current.album) {
    const { albumArtist: _skipped, ...rest } = fields
    return rest
  }
  return fields
}

const CURRENT_OF: Record<MusicReviewField, (c: Current) => string | null> = {
  title: (c) => c.Title,
  artist: (c) => c.artist,
  album: (c) => c.album,
  albumArtist: (c) => c.albumArtist,
  genre: (c) => c.genre,
}

// The track is pointed at the right row instead of the row being renamed: a shared row
// also serves tracks the review never looked at.
function applyUpdate(db: Db, id: string, fields: Fields, current: Current): void {
  const { title, artist, album, albumArtist, genre } = fields
  const set: Record<string, unknown> = {}
  if (title) set.Title = title.to
  if (artist) set.ArtistID = artistId(db, artist.to)
  if (genre) set.GenreID = genreId(db, genre.to)
  if (album || albumArtist) {
    const owner = albumArtist ? artistId(db, albumArtist.to) : current.AlbumArtistID
    set.AlbumID = albumId(db, album ? album.to : (current.album ?? ''), owner)
  }
  set.rb_local_usn = nextUsn(db)
  set.updated_at = stamp()
  const names = Object.keys(set)
  db.prepare(`UPDATE djmdContent SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE ID = ?`).run(
    ...Object.values(set),
    id,
  )
}

export async function updateRekordboxTags(
  collectionPath: string,
  updates: LibraryTagUpdate[],
  options: FindOptions & { sessionBackup?: (path: string) => Promise<void> } = {},
): Promise<LibraryRepointResult[]> {
  const results: (LibraryRepointResult | undefined)[] = updates.map(() => undefined)
  const settle = (r: LibraryRepointResult): LibraryRepointResult[] => results.map((x) => x ?? r)
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })
  const db = openRekordboxDb(collectionPath)
  if (!db) return settle({ written: false, reason: 'unreadable' })
  const writes: { index: number; id: string; current: Current; fields: Fields }[] = []
  try {
    for (const [index, update] of updates.entries()) {
      const match = findTrackByPath(db, update.path, options)
      if (match === null) results[index] = { written: false, reason: 'no-match' }
      else if (isAmbiguous(match)) results[index] = { written: false, reason: 'ambiguous' }
      else {
        const current = currentOf(db, match.id)
        const fields = effectiveFields(update.fields, current)
        const entries = Object.entries(fields) as [MusicReviewField, TagChange][]
        if (entries.length === 0) results[index] = { written: false, reason: 'no-match' }
        else if (entries.every(([field, change]) => same(CURRENT_OF[field](current), change.from)))
          writes.push({ index, id: match.id, current, fields })
        else results[index] = { written: false, reason: 'changed' }
      }
    }
  } finally {
    db.close()
  }
  if (writes.length === 0) return settle({ written: false, reason: 'no-match' })
  try {
    await options.sessionBackup?.(collectionPath)
    await copyFile(collectionPath, `${collectionPath}${BACKUP_SUFFIX}`)
  } catch {
    return settle({ written: false, reason: 'backup-failed' })
  }
  if (await isRekordboxRunning()) return settle({ written: false, reason: 'rekordbox-running' })
  const write = openRekordboxDb(collectionPath)
  if (!write) return settle({ written: false, reason: 'unreadable' })
  try {
    write.transaction(() => {
      for (const w of writes) applyUpdate(write, w.id, w.fields, w.current)
    })()
    for (const w of writes) results[w.index] = { written: true }
    return settle({ written: false, reason: 'no-match' })
  } catch (e) {
    if (String((e as { code?: unknown })?.code).startsWith('SQLITE_READONLY')) {
      for (const w of writes) results[w.index] = { written: false, reason: 'read-only' }
      return settle({ written: false, reason: 'read-only' })
    }
    log.warn(`rekordbox tags: write failed: ${(e as Error).message}`)
    for (const w of writes) results[w.index] = { written: false, reason: 'write-failed' }
    return settle({ written: false, reason: 'write-failed' })
  } finally {
    write.close()
  }
}
