import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildEngineDatabase, type EngineTrack } from './engine'

const track = (over: Partial<EngineTrack> = {}): EngineTrack => ({
  relativePath: 'Music/a.mp3',
  filename: 'a.mp3',
  fileType: 'mp3',
  fileBytes: 1000,
  title: 'A',
  artist: 'B',
  album: '',
  genre: '',
  comment: '',
  bpm: null,
  bpmAnalyzed: null,
  year: null,
  durationSec: null,
  ...over,
})

// Re-open the exported bytes with the same SQLite engine Engine DJ would, so the tests assert
// against the real database the way Engine reads it — the strongest signal short of Engine itself.
async function open(bytes: Uint8Array): Promise<Database> {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const SQL = await initSqlJs({ wasmBinary })
  return new SQL.Database(bytes)
}
function rows(db: Database, sql: string): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  const out: Record<string, unknown>[] = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

describe('buildEngineDatabase', () => {
  let db: Database
  beforeAll(async () => {
    db = await open(
      await buildEngineDatabase(
        [
          track({ relativePath: 'Music/one.mp3', filename: 'one.mp3', title: 'One', bpm: 128 }),
          track({
            relativePath: 'Music/two.flac',
            filename: 'two.flac',
            title: 'Two',
            fileType: 'flac',
          }),
        ],
        'Surco',
      ),
    )
  })

  it('stamps the Engine Library 2.18.0 schema version and a database uuid', () => {
    const info = rows(db, 'SELECT * FROM Information')
    expect(info).toHaveLength(1)
    expect(info[0]).toMatchObject({
      schemaVersionMajor: 2,
      schemaVersionMinor: 18,
      schemaVersionPatch: 0,
    })
    expect(String(info[0].uuid)).toMatch(/[0-9a-f-]{36}/)
  })

  it('creates the no-album-art sentinel row track rows point at', () => {
    expect(rows(db, 'SELECT id FROM AlbumArt WHERE id = 1')).toHaveLength(1)
  })

  it('writes one Track row per file with its metadata and import flags', () => {
    const tracks = rows(db, 'SELECT * FROM Track ORDER BY id')
    expect(tracks).toHaveLength(2)
    expect(tracks[0]).toMatchObject({
      path: 'Music/one.mp3',
      filename: 'one.mp3',
      title: 'One',
      bpm: 128,
      fileType: 'mp3',
      albumArtId: 1,
      // Engine treats isAvailable=0 as missing and won't play it; a metadata-only import is
      // explicitly not analyzed so Engine re-analyses (beatgrid/waveform) on first load.
      isAvailable: 1,
      isAnalyzed: 0,
    })
  })

  it('lets the fix-origin trigger stamp each track with this database and its own id', () => {
    const uuid = rows(db, 'SELECT uuid FROM Information')[0].uuid
    const tracks = rows(db, 'SELECT id, originDatabaseUuid, originTrackId FROM Track ORDER BY id')
    for (const t of tracks) {
      expect(t.originDatabaseUuid).toBe(uuid)
      expect(t.originTrackId).toBe(t.id)
    }
  })

  it('adds the playlist as a top-level persisted list', () => {
    const lists = rows(db, 'SELECT * FROM Playlist')
    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({
      title: 'Surco',
      parentListId: 0,
      isPersisted: 1,
      nextListId: 0,
    })
  })

  it('links every track into the playlist in order via the entity linked list', () => {
    const uuid = rows(db, 'SELECT uuid FROM Information')[0].uuid
    const entities = rows(db, 'SELECT * FROM PlaylistEntity ORDER BY id')
    expect(entities).toHaveLength(2)
    expect(entities.every((e) => e.databaseUuid === uuid)).toBe(true)
    // First entity points at the second; the last terminates the list with 0.
    expect(entities[0].nextEntityId).toBe(entities[1].id)
    expect(entities[1].nextEntityId).toBe(0)
  })
})
