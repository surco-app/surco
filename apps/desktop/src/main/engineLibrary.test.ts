import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { buildEngineDatabase } from './engine'
import { addToEngineLibrary } from './engineLibrary'
import { isEngineDjRunning } from './engineProcess'

// The real probe shells out to pgrep/tasklist; tests pin it so they never depend on
// what happens to be running on the machine (Engine DJ itself, for instance).
vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

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
    await addToEngineLibrary(lib, file, meta(), 'Surco')
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
            rating: 0,
          },
        ],
        'Sets',
      ),
    )
    const file = await makeFile(root, 'two.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'Two' }), 'Surco')
    const db = await open(dbPath)
    expect(rows(db, 'SELECT title FROM Track ORDER BY id').map((r) => r.title)).toEqual([
      'Old',
      'Two',
    ])
    expect(rows(db, 'SELECT title FROM Playlist ORDER BY id').map((r) => r.title)).toEqual([
      'Sets',
      'Surco',
    ])
    db.close()
    expect((await stat(join(lib, 'Database2', 'm.db.surco-backup'))).size).toBeGreaterThan(0)
  })

  // Re-converting an edited track must update its row, not import a duplicate — and it
  // must not reset analysis columns Engine already filled for that file.
  it('updates the existing row for a path instead of duplicating it', async () => {
    const lib = join(root, 'upsert', 'Engine Library')
    const file = await makeFile(root, 'three.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'First pass' }), 'Surco')
    const dbPath = join(lib, 'Database2', 'm.db')
    const before = await open(dbPath)
    before.run('UPDATE Track SET isAnalyzed = 1')
    await writeFile(dbPath, before.export())
    before.close()
    await addToEngineLibrary(lib, file, meta({ title: 'Second pass', bpm: '130' }), 'Surco')
    const db = await open(dbPath)
    const tracks = rows(db, 'SELECT * FROM Track')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toMatchObject({ title: 'Second pass', bpm: 130, isAnalyzed: 1 })
    db.close()
  })

  // Engine grades tracks on a 0-100 scale (20 per star), not the "1"-"5" tag value —
  // writing the raw star count reads as no stars in Engine's rating column.
  it("maps the tag's stars onto Engine's 0-100 rating scale, updating on re-convert", async () => {
    const lib = join(root, 'rating', 'Engine Library')
    const file = await makeFile(root, 'rated.aiff')
    await addToEngineLibrary(lib, file, meta({ rating: '5' }), 'Surco')
    const dbPath = join(lib, 'Database2', 'm.db')
    const first = await open(dbPath)
    expect(rows(first, 'SELECT rating FROM Track')[0].rating).toBe(100)
    first.close()
    await addToEngineLibrary(lib, file, meta({ rating: '3' }), 'Surco')
    const db = await open(dbPath)
    expect(rows(db, 'SELECT rating FROM Track')[0].rating).toBe(60)
    db.close()
  })

  // A non-empty WAL means Engine DJ has the database open with unflushed writes;
  // rewriting m.db underneath it would corrupt the DJ's library.
  it('refuses to write while Engine DJ holds the library open', async () => {
    const lib = join(root, 'locked', 'Engine Library')
    const file = await makeFile(root, 'four.aiff')
    await addToEngineLibrary(lib, file, meta(), 'Surco')
    await writeFile(join(lib, 'Database2', 'm.db-wal'), 'pending frames')
    await expect(addToEngineLibrary(lib, file, meta(), 'Surco')).rejects.toThrow(/Engine DJ/)
  })

  // Engine DJ 4.x runs its database in rollback-journal mode (m.db-journal, not -wal),
  // so a hot journal is the same "library in use / mid-transaction" signal.
  it('refuses to write over a hot rollback journal', async () => {
    const lib = join(root, 'journal', 'Engine Library')
    const file = await makeFile(root, 'five.aiff')
    await addToEngineLibrary(lib, file, meta(), 'Surco')
    await writeFile(join(lib, 'Database2', 'm.db-journal'), 'hot journal pages')
    await expect(addToEngineLibrary(lib, file, meta(), 'Surco')).rejects.toThrow(/Engine DJ/)
  })

  // Journal files are only non-empty mid-transaction, so the reliable "Engine DJ is
  // open" signal is the process itself: it loads the library once at launch, never
  // re-reads it, and our rename-over-m.db would orphan the file its connection holds.
  it('refuses to write while the Engine DJ process is running', async () => {
    const lib = join(root, 'process', 'Engine Library')
    const file = await makeFile(root, 'six.aiff')
    vi.mocked(isEngineDjRunning).mockResolvedValueOnce(true)
    await expect(addToEngineLibrary(lib, file, meta(), 'Surco')).rejects.toThrow(/Engine DJ/)
  })

  // Bulk conversions finish in parallel; every add must land even when they overlap,
  // because the writer serializes whole-file rewrites of the same database.
  it('lands every track from overlapping adds', async () => {
    const lib = join(root, 'parallel', 'Engine Library')
    const files = await Promise.all(
      ['p1.aiff', 'p2.aiff', 'p3.aiff'].map((n) => makeFile(root, n)),
    )
    await Promise.all(
      files.map((f, i) => addToEngineLibrary(lib, f, meta({ title: `P${i + 1}` }), 'Surco')),
    )
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT title FROM Track ORDER BY title').map((r) => r.title)).toEqual([
      'P1',
      'P2',
      'P3',
    ])
    // All three must also be members of the playlist, chained into one valid list:
    // exactly one tail, and every entity reachable.
    const entities = rows(db, 'SELECT * FROM PlaylistEntity')
    expect(entities).toHaveLength(3)
    expect(entities.filter((e) => e.nextEntityId === 0)).toHaveLength(1)
    db.close()
  })
})

describe('addToEngineLibrary — playlist membership', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'surco-engine-pl-'))
  })

  // The playlist is how the DJ finds what Surco just converted: tracks must land in a
  // root playlist with the configured name, stamped with this library's own uuid.
  it('creates the configured playlist and links the track into it', async () => {
    const lib = join(root, 'fresh', 'Engine Library')
    const file = await makeFile(root, 'one.aiff')
    await addToEngineLibrary(lib, file, meta(), 'Nuevos')
    const db = await open(join(lib, 'Database2', 'm.db'))
    const lists = rows(db, 'SELECT * FROM Playlist')
    expect(lists).toHaveLength(1)
    expect(lists[0]).toMatchObject({ title: 'Nuevos', parentListId: 0, isPersisted: 1 })
    const uuid = rows(db, 'SELECT uuid FROM Information')[0].uuid
    const entities = rows(db, 'SELECT * FROM PlaylistEntity')
    expect(entities).toHaveLength(1)
    expect(entities[0]).toMatchObject({
      listId: lists[0].id,
      databaseUuid: uuid,
      nextEntityId: 0,
    })
    db.close()
  })

  // Adding into a library that already has root playlists must chain the new one at
  // the tail (the sibling linked list Engine renders the tree from), not clash with
  // the UNIQUE(parentListId, nextListId) constraint.
  it('appends the playlist after existing root playlists', async () => {
    const lib = join(root, 'chain', 'Engine Library')
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
            rating: 0,
          },
        ],
        'Sets',
      ),
    )
    const file = await makeFile(root, 'two.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'Two' }), 'Surco')
    const db = await open(dbPath)
    const lists = rows(db, 'SELECT * FROM Playlist ORDER BY id')
    expect(lists.map((l) => l.title)).toEqual(['Sets', 'Surco'])
    expect(lists[0].nextListId).toBe(lists[1].id)
    expect(lists[1].nextListId).toBe(0)
    expect(rows(db, 'PRAGMA integrity_check').map((r) => r.integrity_check)).toEqual(['ok'])
    db.close()
  })

  // Re-converting a track already in the playlist must not add a second entry — the
  // playlist mirrors the crate, it is not a conversion log.
  it('does not duplicate the membership on re-convert', async () => {
    const lib = join(root, 'dedup', 'Engine Library')
    const file = await makeFile(root, 'three.aiff')
    await addToEngineLibrary(lib, file, meta({ title: 'First' }), 'Surco')
    await addToEngineLibrary(lib, file, meta({ title: 'Again' }), 'Surco')
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT * FROM PlaylistEntity')).toHaveLength(1)
    expect(rows(db, 'SELECT * FROM Playlist')).toHaveLength(1)
    db.close()
  })

  // Two conversions with different configured names (the setting changed in between)
  // land in their own playlists; membership follows the name at conversion time.
  it('reuses the playlist by name and creates another for a different name', async () => {
    const lib = join(root, 'names', 'Engine Library')
    const one = await makeFile(root, 'n1.aiff')
    const two = await makeFile(root, 'n2.aiff')
    await addToEngineLibrary(lib, one, meta({ title: 'N1' }), 'Surco')
    await addToEngineLibrary(lib, two, meta({ title: 'N2' }), 'Pool')
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT title FROM Playlist ORDER BY id').map((r) => r.title)).toEqual([
      'Surco',
      'Pool',
    ])
    expect(rows(db, 'SELECT COUNT(*) AS n FROM PlaylistEntity')[0].n).toBe(2)
    db.close()
  })
})

describe('addToEngineLibrary — album art', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'surco-engine-art-'))
  })

  async function makeCover(name: string, bytes: string): Promise<string> {
    const p = join(root, name)
    await writeFile(p, bytes)
    return p
  }

  // Engine renders artwork only from its own AlbumArt blobs — the file's embedded
  // picture is never read — so the add must store the cover and point the row at it.
  it('stores the cover as an AlbumArt blob and points the track at it', async () => {
    const lib = join(root, 'art', 'Engine Library')
    const file = await makeFile(root, 'a1.aiff')
    const cover = await makeCover('a1.jpg', 'jpeg-bytes-one')
    await addToEngineLibrary(lib, file, meta(), 'Surco', cover)
    const db = await open(join(lib, 'Database2', 'm.db'))
    const art = rows(db, 'SELECT id, hash, length(albumArt) AS bytes FROM AlbumArt WHERE id > 1')
    expect(art).toHaveLength(1)
    expect(art[0].bytes).toBe('jpeg-bytes-one'.length)
    expect(String(art[0].hash)).toMatch(/^[0-9a-f]{40}$/)
    expect(rows(db, 'SELECT albumArtId FROM Track')[0].albumArtId).toBe(art[0].id)
    db.close()
  })

  // Two tracks off one release share the same image; storing it once per track would
  // balloon the database with identical blobs.
  it('reuses the stored blob for a second track with the same cover', async () => {
    const lib = join(root, 'dedup-art', 'Engine Library')
    const cover = await makeCover('shared.jpg', 'jpeg-shared')
    await addToEngineLibrary(lib, await makeFile(root, 'a2.aiff'), meta({ title: 'A2' }), 'Surco', cover)
    await addToEngineLibrary(lib, await makeFile(root, 'a3.aiff'), meta({ title: 'A3' }), 'Surco', cover)
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT id FROM AlbumArt WHERE id > 1')).toHaveLength(1)
    const ids = rows(db, 'SELECT DISTINCT albumArtId FROM Track')
    expect(ids).toHaveLength(1)
    db.close()
  })

  // A re-convert with new artwork must swap the existing row's art, not strand it on
  // the old image.
  it('repoints an existing row at fresh artwork on re-convert', async () => {
    const lib = join(root, 'swap-art', 'Engine Library')
    const file = await makeFile(root, 'a4.aiff')
    await addToEngineLibrary(lib, file, meta(), 'Surco', await makeCover('old.jpg', 'old-art'))
    await addToEngineLibrary(lib, file, meta(), 'Surco', await makeCover('new.jpg', 'new-art'))
    const db = await open(join(lib, 'Database2', 'm.db'))
    const tracks = rows(db, 'SELECT albumArtId FROM Track')
    expect(tracks).toHaveLength(1)
    const art = rows(db, `SELECT albumArt FROM AlbumArt WHERE id = ${tracks[0].albumArtId}`)
    expect(new TextDecoder().decode(art[0].albumArt as Uint8Array)).toBe('new-art')
    db.close()
  })

  // No cover stays on the no-art sentinel — never a dangling albumArtId.
  it('leaves the track on the sentinel art row when no cover is given', async () => {
    const lib = join(root, 'no-art', 'Engine Library')
    await addToEngineLibrary(lib, await makeFile(root, 'a5.aiff'), meta(), 'Surco')
    const db = await open(join(lib, 'Database2', 'm.db'))
    expect(rows(db, 'SELECT albumArtId FROM Track')[0].albumArtId).toBe(1)
    db.close()
  })
})

describe('dumpEngineLibrary', () => {
  let root: string
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'surco-engine-dump-'))
  })

  // The membership check matches by title/artist/duration, the same shape the Apple
  // Music dump feeds the renderer's index with.
  it('reads the library rows as membership candidates', async () => {
    const lib = join(root, 'lib', 'Engine Library')
    await addToEngineLibrary(lib, await makeFile(root, 'd1.aiff'), meta({ title: 'Dump One' }), 'Surco')
    const { dumpEngineLibrary } = await import('./engineLibrary')
    expect(await dumpEngineLibrary(lib)).toEqual([{ title: 'Dump One', artist: 'A' }])
  })

  // No library yet (the user never converted there) is a normal state, not an error:
  // every row simply stays without a verdict.
  it('reports an empty library when the database is missing', async () => {
    const { dumpEngineLibrary } = await import('./engineLibrary')
    expect(await dumpEngineLibrary(join(root, 'nowhere', 'Engine Library'))).toEqual([])
  })
})
