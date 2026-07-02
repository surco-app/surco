import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { buildEngineDatabase } from './engine'
import { addToEngineLibrary } from './engineLibrary'

const meta = (over: Partial<TrackMetadata> = {}): TrackMetadata => ({
  title: 'One',
  artist: 'A',
  album: 'LP',
  albumArtist: '',
  year: '2020',
  genre: 'House',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '128',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
  ...over,
})

// Re-open the written m.db with the same SQLite engine Engine DJ would, so the tests
// assert against the real database the way Engine reads it.
async function open(path: string): Promise<Database> {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const wasmBinary = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  const SQL = await initSqlJs({ wasmBinary })
  return new SQL.Database(await readFile(path))
}
function rows(db: Database, sql: string): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  const out: Record<string, unknown>[] = []
  while (stmt.step()) out.push(stmt.getAsObject())
  stmt.free()
  return out
}

// A converted file the library rows will point at; the content only matters for its size.
async function makeFile(dir: string, name: string): Promise<string> {
  const p = join(dir, name)
  await writeFile(p, 'audio-bytes')
  return p
}

describe('addToEngineLibrary', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'surco-engine-'))
  })

  it('bootstraps a valid Engine library at the configured folder when none exists', async () => {
    const lib = join(root, 'fresh', 'Engine Library')
    const file = await makeFile(root, 'one.aiff')
    await addToEngineLibrary(lib, file, meta())
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'PRAGMA integrity_check').map((r) => r.integrity_check)).toEqual(['ok'])
    expect(rows(db, 'SELECT uuid FROM Information')).toHaveLength(1)
    const tracks = rows(db, 'SELECT * FROM Track')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({
      path: '../../one.aiff',
      filename: 'one.aiff',
      fileType: 'aiff',
      title: 'One',
      artist: 'A',
      bpm: 128,
      year: 2020,
      isAvailable: 1,
      isAnalyzed: 0,
    })
    db.close()
  })

  // The whole point of the destination: conversions land in the DJ's real library, so
  // an add must extend it — never rebuild it — and leave a backup of the previous file.
  it('appends into an existing library, keeping its rows and backing up the database', async () => {
    const lib = join(root, 'existing', 'Engine Library')
    const dbPath = join(lib, 'Database2', 'm.db')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(lib, 'Database2'), { recursive: true })
    await writeFile(
      dbPath,
      await buildEngineDatabase(
        [
          {
            relativePath: 'Music/old.mp3',
            filename: 'old.mp3',
            fileType: 'mp3',
            fileBytes: 10,
            title: 'Old',
            artist: 'X',
            album: '',
            genre: '',
            comment: '',
            bpm: null,
            bpmAnalyzed: null,
            year: null,
            durationSec: null,
          },
        ],
        'Sets',
      ),
    )
    const file = await makeFile(root, 'two.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'Two' }))
    const db = await open(dbPath)
    expect(rows(db, 'SELECT title FROM Track ORDER BY id').map((r) => r.title)).toEqual([
      'Old',
      'Two',
    ])
    expect(rows(db, 'SELECT title FROM Playlist').map((r) => r.title)).toEqual(['Sets'])
    db.close()
    expect((await stat(join(lib, 'Database2', 'm.db.surco-backup'))).size).toBeGreaterThan(0)
  })

  // Re-converting an edited track must update its row, not import a duplicate — and it
  // must not reset analysis columns Engine already filled for that file.
  it('updates the existing row for a path instead of duplicating it', async () => {
    const lib = join(root, 'upsert', 'Engine Library')
    const file = await makeFile(root, 'three.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'First pass' }))
    const dbPath = join(lib, 'Database2', 'm.db')
    const before = await open(dbPath)
    before.run('UPDATE Track SET isAnalyzed = 1')
    await writeFile(dbPath, before.export())
    before.close()
    await addToEngineLibrary(lib, file, meta({ title: 'Second pass', bpm: '130' }))
    const db = await open(dbPath)
    const tracks = rows(db, 'SELECT * FROM Track')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ title: 'Second pass', bpm: 130, isAnalyzed: 1 })
    db.close()
  })

  // A non-empty WAL means Engine DJ has the database open with unflushed writes;
  // rewriting m.db underneath it would corrupt the DJ's library.
  it('refuses to write while Engine DJ holds the library open', async () => {
    const lib = join(root, 'locked', 'Engine Library')
    const file = await makeFile(root, 'four.aiff')
    await addToEngineLibrary(lib, file, meta())
    await writeFile(join(lib, 'Database2', 'm.db-wal'), 'pending frames')
    await expect(addToEngineLibrary(lib, file, meta())).rejects.toThrow(/Engine DJ/)
  })

  // Bulk conversions finish in parallel; every add must land even when they overlap,
  // because the writer serializes whole-file rewrites of the same database.
  it('lands every track from overlapping adds', async () => {
    const lib = join(root, 'parallel', 'Engine Library')
    const files = await Promise.all(
      ['p1.aiff', 'p2.aiff', 'p3.aiff'].map((n) => makeFile(root, n)),
    )
    await Promise.all(
      files.map((f, i) => addToEngineLibrary(lib, f, meta({ title: `P${i + 1}` }))),
    )
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT title FROM Track ORDER BY title').map((r) => r.title)).toEqual([
      'P1',
      'P2',
      'P3',
    ])
    db.close()
  })
})
