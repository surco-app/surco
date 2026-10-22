import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { ENGINE_3_SCHEMA } from './engine3Fixture'

export interface EngineFixture {
  tracks: {
    id: number
    path: string | null
    title?: string
    artist?: string
    length?: number
    bpm?: number
    bpmAnalyzed?: number
    rating?: number
    albumArtId?: number
  }[]
  art?: { id: number; bytes: Uint8Array }[]
  playlists: { id: number; title: string; parentListId: number; nextListId: number }[]
  entities: { id: number; listId: number; trackId: number; nextEntityId: number }[]
  wal?: boolean
}

export function engineDbPath(libraryDir: string): string {
  return join(libraryDir, 'Database2', 'm.db')
}

export function writeEngineLibraryFixture(
  libraryDir: string,
  data: EngineFixture,
): Database.Database {
  mkdirSync(join(libraryDir, 'Database2'), { recursive: true })
  const db = new Database(engineDbPath(libraryDir))
  if (data.wal) db.pragma('journal_mode = WAL')
  db.exec(ENGINE_3_SCHEMA)
  db.exec('DROP TRIGGER trigger_before_insert_List; DROP TRIGGER trigger_after_insert_List;')
  db.prepare(`INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor,
    schemaVersionPatch) VALUES ('fixture-uuid', 3, 0, 2)`).run()
  db.prepare('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (1, NULL, NULL)').run()
  const art = db.prepare('INSERT INTO AlbumArt (id, hash, albumArt) VALUES (?, ?, ?)')
  for (const a of data.art ?? []) art.run(a.id, `hash-${a.id}`, Buffer.from(a.bytes))
  const track = db.prepare(`INSERT INTO Track (id, path, filename, title, artist, length, bpm,
    bpmAnalyzed, rating, albumArtId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  for (const t of data.tracks)
    track.run(
      t.id,
      t.path,
      t.path?.split('/').pop() ?? null,
      t.title ?? null,
      t.artist ?? null,
      t.length ?? null,
      t.bpm ?? null,
      t.bpmAnalyzed ?? null,
      t.rating ?? 0,
      t.albumArtId ?? 1,
    )
  const list = db.prepare(`INSERT INTO Playlist (id, title, parentListId, isPersisted,
    nextListId, isExplicitlyExported) VALUES (?, ?, ?, 1, ?, 1)`)
  for (const p of data.playlists) list.run(p.id, p.title, p.parentListId, p.nextListId)
  const entity = db.prepare(`INSERT INTO PlaylistEntity (id, listId, trackId, databaseUuid,
    nextEntityId, membershipReference) VALUES (?, ?, ?, 'fixture-uuid', ?, 0)`)
  for (const e of data.entities) entity.run(e.id, e.listId, e.trackId, e.nextEntityId)
  return db
}
