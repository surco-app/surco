import { randomInt, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { TrackMetadata } from '../shared/types'

type Db = InstanceType<typeof Database>

export interface RekordboxMeta {
  title: string
  artist: string
  album: string
  albumArtist: string
  genre: string
  label: string
  remixer: string
  comment: string
  year: string
  trackNumber: string
  discNumber: string
}

export interface ApplyOptions {
  now?: Date
  newId?: () => string
}

type LookupTable = 'djmdArtist' | 'djmdGenre' | 'djmdLabel'

export function rekordboxMetaFrom(meta: TrackMetadata): RekordboxMeta {
  return {
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    albumArtist: meta.albumArtist,
    genre: meta.genre,
    label: meta.publisher,
    remixer: meta.remixArtist,
    comment: meta.comment,
    year: meta.year,
    trackNumber: meta.trackNumber,
    discNumber: meta.discNumber,
  }
}

function timestamp(now: Date): string {
  return `${now.toISOString().replace('T', ' ').replace('Z', '')} +00:00`
}

function leadingNumber(value: string): number | null {
  const match = /^\s*(\d+)\s*(?:\/\s*\d+\s*)?$/.exec(value)
  return match ? Number(match[1]) : null
}

function yearOf(value: string): number | null {
  const match = /^\s*(\d{4})(?:-\d{2}(?:-\d{2})?)?\s*$/.exec(value)
  return match ? Number(match[1]) : null
}

function randomRowId(): string {
  return String(randomInt(1, 2 ** 32))
}

export function applyRekordboxMeta(
  db: Db,
  contentId: string,
  meta: RekordboxMeta,
  options: ApplyOptions = {},
): void {
  const stamp = timestamp(options.now ?? new Date())
  const nextId = options.newId ?? randomRowId

  const nextUsn = (): number => {
    const { int_1 } = db
      .prepare(`SELECT int_1 FROM agentRegistry WHERE registry_id = 'localUpdateCount'`)
      .get() as { int_1: number }
    const usn = Number(int_1) + 1
    db.prepare(
      `UPDATE agentRegistry SET int_1 = ?, updated_at = ? WHERE registry_id = 'localUpdateCount'`,
    ).run(usn, stamp)
    return usn
  }

  const unusedId = (table: string): string => {
    const taken = db.prepare(`SELECT 1 FROM ${table} WHERE ID = ?`)
    for (;;) {
      const id = nextId()
      if (!taken.get(id)) return id
    }
  }

  const insertRow = (table: string, columns: Record<string, string | null>): string => {
    const id = unusedId(table)
    const values = {
      ID: id,
      ...columns,
      UUID: randomUUID(),
      rb_data_status: 0,
      rb_local_data_status: 0,
      rb_local_deleted: 0,
      rb_local_synced: 0,
      usn: null,
      rb_local_usn: nextUsn(),
      created_at: stamp,
      updated_at: stamp,
    }
    const names = Object.keys(values)
    db.prepare(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
    ).run(...Object.values(values))
    return id
  }

  const fold = (value: string): string => value.normalize('NFC').toLocaleLowerCase()

  const liveRows = (table: string, where = '', ...params: (string | null)[]) =>
    db
      .prepare(
        `SELECT ID, Name FROM ${table}
          WHERE (rb_local_deleted IS NULL OR rb_local_deleted = 0) ${where}`,
      )
      .all(...params) as { ID: string; Name: string | null }[]

  const pick = (rows: { ID: string; Name: string | null }[], name: string): string | null => {
    const exact = rows.find((r) => r.Name === name)
    if (exact) return exact.ID
    const folded = rows.find((r) => r.Name !== null && fold(r.Name) === fold(name))
    return folded ? folded.ID : null
  }

  const named = (table: LookupTable, name: string): string =>
    pick(liveRows(table), name) ?? insertRow(table, { Name: name })

  const albumFor = (name: string, albumArtistId: string | null): string =>
    pick(liveRows('djmdAlbum', 'AND AlbumArtistID IS ?', albumArtistId), name) ??
    insertRow('djmdAlbum', { Name: name, AlbumArtistID: albumArtistId })

  const set: Record<string, string | number> = {}
  const text = (value: string): string | null => (value.trim() ? value.trim() : null)

  const title = text(meta.title)
  if (title) set.Title = title
  const comment = text(meta.comment)
  if (comment) set.Commnt = comment
  const artist = text(meta.artist)
  const artistId = artist ? named('djmdArtist', artist) : null
  if (artistId) set.ArtistID = artistId
  const genre = text(meta.genre)
  if (genre) set.GenreID = named('djmdGenre', genre)
  const label = text(meta.label)
  if (label) set.LabelID = named('djmdLabel', label)
  const remixer = text(meta.remixer)
  if (remixer) set.RemixerID = named('djmdArtist', remixer)
  const album = text(meta.album)
  if (album) {
    const albumArtist = text(meta.albumArtist)
    set.AlbumID = albumFor(album, albumArtist ? named('djmdArtist', albumArtist) : artistId)
  }
  const year = yearOf(meta.year)
  if (year !== null) set.ReleaseYear = year
  const track = leadingNumber(meta.trackNumber)
  if (track !== null) set.TrackNo = track
  const disc = leadingNumber(meta.discNumber)
  if (disc !== null) set.DiscNo = disc

  if (Object.keys(set).length === 0) return
  set.rb_local_usn = nextUsn()
  set.updated_at = stamp
  db.prepare(
    `UPDATE djmdContent SET ${Object.keys(set)
      .map((column) => `${column} = ?`)
      .join(', ')} WHERE ID = ?`,
  ).run(...Object.values(set), contentId)
}
