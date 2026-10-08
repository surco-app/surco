import { access, mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs, { type SqlJsStatic } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { replaceEngineDuplicates } from './engineDuplicates'
import { isEngineDjRunning } from './engineProcess'
import { renameWithRetry } from './renameRetry'

vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
vi.mock('./renameRetry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./renameRetry')>()
  return { ...actual, renameWithRetry: vi.fn(actual.renameWithRetry) }
})

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
})

const UUID = 'db-uuid'

interface Library {
  dir: string
  dbPath: string
  from: string
  to: string
}

// Lists as Engine keeps them: each entity names the next one, 0 ends the list.
// A: [from, x]   B: [to, from, x]   C: [from, to]
async function library(withTo = true): Promise<Library> {
  const root = await mkdtemp(join(tmpdir(), 'surco-engine-dup-'))
  const dir = join(root, 'Engine Library')
  const music = join(root, 'music')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  await mkdir(music)
  await writeFile(join(music, 'from.aiff'), Buffer.alloc(10))
  await writeFile(join(music, 'to.aiff'), Buffer.alloc(20))
  const db = new SQL.Database()
  db.exec(ENGINE_3_SCHEMA)
  db.run(`INSERT INTO Information (uuid, schemaVersionMajor) VALUES (?, 3)`, [UUID])
  const track = (path: string) =>
    db.run(`INSERT INTO Track (path, filename, fileType) VALUES (?, ?, 'aiff')`, [
      path,
      path.split('/').pop() as string,
    ])
  track('../music/from.aiff')
  track(withTo ? '../music/to.aiff' : '../music/elsewhere.aiff')
  track('../music/x.aiff')
  db.run(`UPDATE PerformanceData SET quickCues = X'0102' WHERE trackId = 1`)
  for (const title of ['A', 'B', 'C'])
    db.run(
      `INSERT INTO Playlist (title, parentListId, isPersisted, nextListId) VALUES (?, 0, 1, 0)`,
      [title],
    )
  const entity = (id: number, list: number, trackId: number, next: number) =>
    db.run(
      `INSERT INTO PlaylistEntity (id, listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (?, ?, ?, ?, ?, 0)`,
      [id, list, trackId, UUID, next],
    )
  entity(1, 1, 1, 2)
  entity(2, 1, 3, 0)
  entity(3, 2, 2, 4)
  entity(4, 2, 1, 5)
  entity(5, 2, 3, 0)
  entity(6, 3, 1, 7)
  entity(7, 3, 2, 0)
  const dbPath = join(dir, 'Database2', 'm.db')
  await writeFile(dbPath, db.export())
  db.close()
  return { dir, dbPath, from: join(music, 'from.aiff'), to: join(music, 'to.aiff') }
}

async function rows(dbPath: string, sql: string): Promise<unknown[][]> {
  const db = new SQL.Database(await readFile(dbPath))
  const values = db.exec(sql)[0]?.values ?? []
  db.close()
  return values
}

// Follows the links from the entity nobody points at, so a broken chain shows up as a
// shorter or looping walk.
async function walk(dbPath: string, list: number): Promise<number[]> {
  const entities = (
    await rows(
      dbPath,
      `SELECT id, trackId, nextEntityId FROM PlaylistEntity WHERE listId = ${list}`,
    )
  ).map(([id, trackId, next]) => ({ id: Number(id), trackId: Number(trackId), next: Number(next) }))
  const pointed = new Set(entities.map((e) => e.next))
  const heads = entities.filter((e) => !pointed.has(e.id))
  expect(heads).toHaveLength(1)
  const tracks: number[] = []
  let at = heads[0]
  for (let i = 0; at && i <= entities.length; i++) {
    tracks.push(at.trackId)
    const next = at.next
    at = entities.find((e) => e.id === next) as (typeof entities)[number]
  }
  expect(tracks).toHaveLength(entities.length)
  return tracks
}

beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))

describe('replaceEngineDuplicates with both copies in the library', () => {
  it('points the entries at the kept copy and drops the ones whose list already has it', async () => {
    const lib = await library()
    const [r] = await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(r).toEqual({ written: true, outcome: 'replaced' })
    expect(await walk(lib.dbPath, 1)).toEqual([2, 3])
    expect(await walk(lib.dbPath, 2)).toEqual([2, 3])
    expect(await walk(lib.dbPath, 3)).toEqual([2])
    expect(await rows(lib.dbPath, 'SELECT id FROM PlaylistEntity ORDER BY id')).toEqual([
      [1],
      [2],
      [3],
      [5],
      [7],
    ])
  })

  it('leaves the entries that belong to another database of the library alone', async () => {
    const lib = await library()
    const db = new SQL.Database(await readFile(lib.dbPath))
    db.run(
      `INSERT INTO PlaylistEntity (id, listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (10, 3, 1, 'other', 0, 0), (11, 1, 2, 'other', 0, 0)`,
    )
    await writeFile(lib.dbPath, db.export())
    db.close()
    await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(
      await rows(
        lib.dbPath,
        `SELECT id, trackId FROM PlaylistEntity WHERE databaseUuid = 'other' ORDER BY id`,
      ),
    ).toEqual([
      [10, 1],
      [11, 2],
    ])
    expect(await rows(lib.dbPath, 'SELECT trackId FROM PlaylistEntity WHERE id = 1')).toEqual([[2]])
  })

  // Engine's history and other databases can name a track id, so removing the row is not
  // proven safe: it stays, and the file stays with it.
  it('keeps the removed copy in the collection with its performance data', async () => {
    const lib = await library()
    await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(await rows(lib.dbPath, 'SELECT id, path FROM Track ORDER BY id')).toEqual([
      [1, '../music/from.aiff'],
      [2, '../music/to.aiff'],
      [3, '../music/x.aiff'],
    ])
    expect(
      await rows(lib.dbPath, 'SELECT hex(quickCues) FROM PerformanceData WHERE trackId = 1'),
    ).toEqual([['0102']])
  })

  it('refuses while Engine DJ is open', async () => {
    const lib = await library()
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    expect(await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])).toEqual([
      { written: false, reason: 'engine-running' },
    ])
    expect(await walk(lib.dbPath, 1)).toEqual([1, 3])
    await expect(access(`${lib.dbPath}.surco-backup`)).rejects.toThrow()
  })

  it('refuses when Engine DJ opens after the rows were read', async () => {
    const lib = await library()
    vi.mocked(isEngineDjRunning).mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    expect(await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])).toEqual([
      { written: false, reason: 'engine-running' },
    ])
    expect(await walk(lib.dbPath, 2)).toEqual([2, 1, 3])
  })

  it('keeps the library as it was in a backup and takes the session copy first', async () => {
    const lib = await library()
    const sessionBackup = vi.fn(async () => {
      await expect(access(`${lib.dbPath}.surco-backup`)).rejects.toThrow()
    })
    await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }], { sessionBackup })
    expect(sessionBackup).toHaveBeenCalledWith(lib.dbPath)
    expect(await walk(`${lib.dbPath}.surco-backup`, 2)).toEqual([2, 1, 3])
  })

  it('writes nothing when the session backup fails', async () => {
    const lib = await library()
    const results = await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }], {
      sessionBackup: async () => Promise.reject(new Error('disk full')),
    })
    expect(results).toEqual([{ written: false, reason: 'backup-failed' }])
    expect(await walk(lib.dbPath, 2)).toEqual([2, 1, 3])
  })

  it('reports a failed swap, keeps the library and leaves no temporary file', async () => {
    const lib = await library()
    vi.mocked(renameWithRetry).mockRejectedValueOnce(new Error('EPERM'))
    const [r] = await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(r).toEqual({ written: false, reason: 'write-failed' })
    expect(await walk(lib.dbPath, 2)).toEqual([2, 1, 3])
    expect(await readdir(join(lib.dir, 'Database2'))).not.toContain('m.db.surco-tmp')
  })
})

describe('replaceEngineDuplicates with one copy in the library', () => {
  it('repoints the removed copy at the kept file, keeping its id and lists', async () => {
    const lib = await library(false)
    const [r] = await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(r).toEqual({ written: true, outcome: 'repointed' })
    expect(await rows(lib.dbPath, 'SELECT path FROM Track WHERE id = 1')).toEqual([
      ['../music/to.aiff'],
    ])
    expect(await walk(lib.dbPath, 2)).toEqual([2, 1, 3])
  })

  // Engine allows one row per path (C_path), so a second repoint onto it cannot land.
  it('repoints only the first removed copy onto a kept file and fails the next', async () => {
    const lib = await library(false)
    const [first, second] = await replaceEngineDuplicates(lib.dir, [
      { from: lib.from, to: lib.to },
      { from: join(lib.dir, '..', 'music', 'x.aiff'), to: lib.to },
    ])
    expect(first).toEqual({ written: true, outcome: 'repointed' })
    expect(second).toEqual({ written: false, reason: 'kept-taken' })
    expect(await rows(lib.dbPath, 'SELECT path FROM Track WHERE id = 3')).toEqual([
      ['../music/x.aiff'],
    ])
  })

  it('touches nothing when the removed copy is not in the library', async () => {
    const lib = await library()
    const [r] = await replaceEngineDuplicates(lib.dir, [
      { from: join(lib.dir, 'nope.aiff'), to: lib.to },
    ])
    expect(r).toEqual({ written: false, reason: 'no-match' })
    await expect(access(`${lib.dbPath}.surco-backup`)).rejects.toThrow()
  })
})

describe('replaceEngineDuplicates when a statement fails', () => {
  it('reports write-failed and leaves the library on disk as it was', async () => {
    const lib = await library()
    const SQLdb = new SQL.Database(await readFile(lib.dbPath))
    SQLdb.run(
      `CREATE TRIGGER refuse BEFORE UPDATE OF trackId ON PlaylistEntity BEGIN SELECT RAISE(ABORT, 'no'); END`,
    )
    await writeFile(lib.dbPath, SQLdb.export())
    SQLdb.close()
    const [r] = await replaceEngineDuplicates(lib.dir, [{ from: lib.from, to: lib.to }])
    expect(r).toEqual({ written: false, reason: 'write-failed' })
    expect(await walk(lib.dbPath, 2)).toEqual([2, 1, 3])
  })
})
