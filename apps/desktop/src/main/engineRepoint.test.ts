import { realpathSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEngineDatabase } from './engine'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { isEngineDjRunning } from './engineProcess'
import { repointEngineTracks } from './engineRepoint'

// The real probe shells out to pgrep/tasklist; tests pin it so they never depend on what
// happens to be running on the machine (Engine DJ itself, for instance).
vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

let SQL: SqlJsStatic
beforeAll(async () => {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
})
beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))

const CUES = new Uint8Array([0, 0, 0, 8, 1, 2, 3, 4])
const GRID = new Uint8Array([0, 0, 0, 4, 5, 6])

interface Library {
  dir: string
  dbPath: string
  oldFile: string
  newFile: string
  music: string
}

// A library laid out the way the user's is: m.db under <library>/Database2 and the music
// beside the library folder, so stored paths start with "../". One track for old.mp3,
// in a playlist, with cues and a beatgrid, plus a new.aiff on disk to move it onto.
async function library(
  schema: '2.18' | '3.0.2',
  rows: string[] = ['../music/old.mp3'],
): Promise<Library> {
  const root = await mkdtemp(join(tmpdir(), 'surco-engine-repoint-'))
  const dir = join(root, 'Engine Library')
  const music = join(root, 'music')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  await mkdir(music)
  const oldFile = join(music, 'old.mp3')
  const newFile = join(music, 'new.aiff')
  await writeFile(oldFile, Buffer.alloc(100))
  await writeFile(newFile, Buffer.alloc(4321))

  let db: Database
  if (schema === '2.18') {
    db = new SQL.Database(
      await buildEngineDatabase(
        rows.map((path) => ({
          relativePath: path,
          filename: 'old.mp3',
          fileType: 'mp3',
          fileBytes: 100,
          title: 'One',
          artist: 'A',
          album: 'LP',
          genre: 'House',
          comment: '',
          bpm: 128,
          bpmAnalyzed: 128,
          year: 2020,
          durationSec: null,
          rating: 0,
        })),
        'Crate',
      ),
    )
    db.run('UPDATE Track SET bitrate = 320, quickCues = ?, beatData = ?', [CUES, GRID])
  } else {
    db = new SQL.Database()
    db.exec(ENGINE_3_SCHEMA)
    db.run(
      "INSERT INTO Information (uuid, schemaVersionMajor, schemaVersionMinor, schemaVersionPatch) VALUES ('lib-uuid', 3, 0, 2)",
    )
    db.run(
      "INSERT INTO Playlist (title, parentListId, isPersisted, nextListId, isExplicitlyExported) VALUES ('Crate', 0, 1, 0, 1)",
    )
    for (const path of rows) {
      db.run(
        "INSERT INTO Track (path, filename, fileType, fileBytes, bitrate, title) VALUES (?, 'old.mp3', 'mp3', 100, 320, 'One')",
        [path],
      )
      const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
      db.run('UPDATE PerformanceData SET quickCues = ?, beatData = ? WHERE trackId = ?', [
        CUES,
        GRID,
        id,
      ])
      db.run(
        "INSERT INTO PlaylistEntity (listId, trackId, databaseUuid, nextEntityId, membershipReference) VALUES (1, ?, 'lib-uuid', 0, 0)",
        [id],
      )
    }
  }
  const dbPath = join(dir, 'Database2', 'm.db')
  await writeFile(dbPath, db.export())
  db.close()
  return { dir, dbPath, oldFile, newFile, music }
}

async function openDb(path: string): Promise<Database> {
  return new SQL.Database(await readFile(path))
}

function one(db: Database, sql: string): Record<string, unknown> {
  const stmt = db.prepare(sql)
  stmt.step()
  const row = stmt.getAsObject()
  stmt.free()
  return row
}

function performance(db: Database, schema: '2.18' | '3.0.2') {
  const table = schema === '2.18' ? 'Track' : 'PerformanceData'
  const key = schema === '2.18' ? 'id' : 'trackId'
  return one(db, `SELECT quickCues, beatData FROM ${table} WHERE ${key} = 1`)
}

describe.each(['2.18', '3.0.2'] as const)('repointEngineTracks on a %s library', (schema) => {
  // The whole point: the row the playlists and the cues hang from stays the same row, so a
  // better copy of a track never has to be put back in every crate by hand.
  it('points the existing row at the new file and keeps its playlists and cues', async () => {
    const lib = await library(schema)
    const [result] = await repointEngineTracks(lib.dir, [{ from: lib.oldFile, to: lib.newFile }])
    expect(result).toEqual({ written: true, id: '1' })

    const db = await openDb(lib.dbPath)
    expect(one(db, 'SELECT COUNT(*) AS n FROM Track').n).toBe(1)
    expect(one(db, 'SELECT id, path, filename, fileType, fileBytes, bitrate FROM Track')).toEqual({
      id: 1,
      path: '../music/new.aiff',
      filename: 'new.aiff',
      fileType: 'aiff',
      fileBytes: 4321,
      // Left for Engine to fill on its next analysis, as Surco's own inserts do: the old
      // MP3's 320 would describe an AIFF as a lossy file.
      bitrate: null,
    })
    expect(one(db, 'SELECT trackId FROM PlaylistEntity').trackId).toBe(1)
    const perf = performance(db, schema)
    expect(perf.quickCues).toEqual(CUES)
    expect(perf.beatData).toEqual(GRID)
  })

  // Engine imported only part of the user's music, so most conversions have no row there.
  // Nothing may be written for them, not even an unchanged copy of the library.
  it('leaves the library untouched for a file it never had', async () => {
    const lib = await library(schema)
    const before = await stat(lib.dbPath)
    const [result] = await repointEngineTracks(lib.dir, [
      { from: join(lib.music, 'other.mp3'), to: lib.newFile },
    ])
    expect(result).toEqual({ written: false, reason: 'no-match' })
    expect((await stat(lib.dbPath)).mtimeMs).toBe(before.mtimeMs)
  })

  // Engine keeps the library in memory and writes it back on exit, so a write made while it
  // runs would be lost or would clobber what the user did in the meantime.
  it('refuses while Engine DJ is open', async () => {
    const lib = await library(schema)
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    const bytes = await readFile(lib.dbPath)
    const [result] = await repointEngineTracks(lib.dir, [{ from: lib.oldFile, to: lib.newFile }])
    expect(result).toEqual({ written: false, reason: 'engine-running' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
  })

  // Two rows for one file means the library is already confused about it; moving one and
  // leaving the other would split its playlists between two files without saying so.
  it('refuses to choose between two rows for the same file', async () => {
    const lib = await library(schema, ['../music/old.mp3', '../link/old.mp3'])
    await symlink(lib.music, join(lib.dir, '..', 'link'))
    const [result] = await repointEngineTracks(lib.dir, [
      { from: lib.oldFile, to: lib.newFile, realPath: realpathSync },
    ])
    expect(result).toEqual({ written: false, reason: 'ambiguous', ids: ['1', '2'] })
  })

  // Engine stores whatever spelling the file was imported under; the user's music folder
  // has been reachable through a link, and the row must still be found from the real path.
  it('finds a row stored through a symlinked folder', async () => {
    const lib = await library(schema, ['../link/old.mp3'])
    await symlink(lib.music, join(lib.dir, '..', 'link'))
    const [result] = await repointEngineTracks(lib.dir, [
      { from: lib.oldFile, to: lib.newFile, realPath: realpathSync },
    ])
    expect(result).toEqual({ written: true, id: '1' })
  })

  // The new file already has a row of its own (added by hand, or by an earlier convert).
  // Folding the old row onto it would collide on Engine's unique path, and picking which
  // one keeps the cues is the user's call, not ours.
  it('does not move a row onto a file that already has one', async () => {
    const lib = await library(schema, ['../music/old.mp3', '../music/new.aiff'])
    const [result] = await repointEngineTracks(lib.dir, [{ from: lib.oldFile, to: lib.newFile }])
    expect(result).toEqual({ written: false, reason: 'occupied' })
  })

  it('backs the library up, and takes the run copy, before writing', async () => {
    const lib = await library(schema)
    const original = await readFile(lib.dbPath)
    const sessionBackup = vi.fn(async () => {})
    await repointEngineTracks(lib.dir, [{ from: lib.oldFile, to: lib.newFile }], { sessionBackup })
    expect(await readFile(`${lib.dbPath}.surco-backup`)).toEqual(original)
    expect(sessionBackup).toHaveBeenCalledWith(lib.dbPath)
  })

  it('reports a new file that is no longer there', async () => {
    const lib = await library(schema)
    const [result] = await repointEngineTracks(lib.dir, [
      { from: lib.oldFile, to: join(lib.music, 'gone.aiff') },
    ])
    expect(result).toEqual({ written: false, reason: 'output-missing' })
  })
})

it('reports a library it cannot read', async () => {
  const root = await mkdtemp(join(tmpdir(), 'surco-engine-repoint-'))
  await mkdir(join(root, 'Database2'))
  await writeFile(join(root, 'Database2', 'm.db'), 'not a database')
  await writeFile(join(root, 'new.aiff'), 'x')
  const [result] = await repointEngineTracks(root, [
    { from: join(root, 'old.mp3'), to: join(root, 'new.aiff') },
  ])
  expect(result).toEqual({ written: false, reason: 'unreadable' })
})
