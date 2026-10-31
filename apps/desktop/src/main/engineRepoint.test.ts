import { mkdirSync, realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildEngineDatabase } from './engine'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import {
  decodeBeatGrid,
  decodeLoops,
  decodeOverview,
  decodeQuickCues,
  decodeTrackData,
  deflateEngineBlob,
  encodeLoops,
  inflateEngineBlob,
} from './engineBlobs'
import { analysedTrack, quickCuesBlob } from './enginePerformanceFixture'
import { isEngineDjRunning } from './engineProcess'
import { engineLengthOf, repointEngineTracks } from './engineRepoint'
import { backupOf } from './libraryBackups'

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

  // Resolving a stored path pays an lstat per path component, which on the NAS a library
  // lives on is hundreds of ms per hundred rows. Resolving every row of the library for
  // every converted track made a batch's flush grow with library size times batch size.
  it('resolves only the rows that share the file name', async () => {
    const others = Array.from({ length: 40 }, (_, i) => `../music/other-${i}.mp3`)
    const lib = await library(schema, ['../music/old.mp3', ...others])
    const resolved: string[] = []
    const realPath = (p: string) => {
      resolved.push(p)
      return realpathSync(p)
    }
    const [result] = await repointEngineTracks(lib.dir, [
      { from: lib.oldFile, to: lib.newFile, realPath },
    ])
    expect(result).toEqual({ written: true, id: '1' })
    expect(resolved.filter((p) => p.includes('other-'))).toEqual([])
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
    expect(await readFile(backupOf(lib.dbPath, 'backup'))).toEqual(original)
    expect(sessionBackup).toHaveBeenCalledWith(lib.dbPath)
  })

  // A copy keeps the mode of what it copied: a read-only file left a read-only backup, and
  // copying the next one over it was refused, blocking every later write.
  it('replaces a read-only backup left by an earlier write', async () => {
    const lib = await library(schema)
    const original = await readFile(lib.dbPath)
    mkdirSync(dirname(backupOf(lib.dbPath, 'backup')), { recursive: true })
    await writeFile(backupOf(lib.dbPath, 'backup'), 'stale')
    await chmod(backupOf(lib.dbPath, 'backup'), 0o444)
    const [result] = await repointEngineTracks(lib.dir, [{ from: lib.oldFile, to: lib.newFile }])
    expect(result.written).toBe(true)
    expect(await readFile(backupOf(lib.dbPath, 'backup'))).toEqual(original)
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

const RATE = 44100
const TRIM_MS = 1900
const HOT_SEC = [1, 5, 12]
const LOOP_SEC: [number, number] = [8, 10]
const MAIN_SEC: [number, number] = [6, 0.5]

function mainCueTail(adjusted: number, isAdjusted: boolean, fallback: number) {
  const tail = Buffer.alloc(17)
  tail.writeDoubleBE(adjusted, 0)
  tail[8] = isAdjusted ? 1 : 0
  tail.writeDoubleBE(fallback, 9)
  return tail
}

async function analysedLibrary(schema: '2.18' | '3.0.2'): Promise<Library> {
  const lib = await library(schema)
  const perf = analysedTrack(1)
  const loops = encodeLoops([
    {
      label: 'Break',
      start: LOOP_SEC[0] * RATE,
      end: LOOP_SEC[1] * RATE,
      startSet: true,
      endSet: true,
      argb: 0xff00cc00,
    },
    { label: '', start: -1, end: -1, startSet: false, endSet: false, argb: 0 },
  ])
  const db = await openDb(lib.dbPath)
  db.run(
    'UPDATE PerformanceData SET trackData = ?, beatData = ?, quickCues = ?, loops = ? WHERE trackId = 1',
    [
      perf.trackData as Buffer,
      perf.beatData as Buffer,
      quickCuesBlob(
        HOT_SEC.map((s, i) => ({ label: `C${i}`, sample: s * RATE, argb: 0xffcc0000 })),
        mainCueTail(MAIN_SEC[0] * RATE, true, MAIN_SEC[1] * RATE),
      ),
      loops,
    ],
  )
  await writeFile(lib.dbPath, db.export())
  db.close()
  return lib
}

function defaultGrid(raw: Buffer): number[] {
  const count = Number(raw.readBigInt64BE(17))
  return Array.from({ length: count }, (_, i) => raw.readDoubleLE(25 + i * 24))
}

async function positionsOf(lib: Library) {
  const db = await openDb(lib.dbPath)
  try {
    const row = one(
      db,
      'SELECT trackData, beatData, quickCues, loops FROM PerformanceData WHERE trackId = 1',
    )
    const track = decodeTrackData(inflateEngineBlob(row.trackData as Uint8Array))
    const rate = track?.sampleRate ?? 0
    const beats = inflateEngineBlob(row.beatData as Uint8Array)
    const cues = decodeQuickCues(inflateEngineBlob(row.quickCues as Uint8Array))
    const sec = (sample: number) => (sample < 0 ? sample : sample / rate)
    return {
      rate,
      lengthSec: (track?.sampleCount ?? 0) / rate,
      gridRate: beats.readDoubleBE(0),
      gridLengthSec: beats.readDoubleBE(8) / rate,
      hot: cues?.slots.map((s) => (s.cue ? s.cue.sample / rate : null)),
      main: [sec(cues?.tail.readDoubleBE(0) ?? 0), sec(cues?.tail.readDoubleBE(9) ?? 0)],
      mainAdjusted: cues?.tail[8],
      loops: decodeLoops(Buffer.from(row.loops as Uint8Array))?.loops.map((l) => [
        sec(l.start),
        sec(l.end),
      ]),
      grid: decodeBeatGrid(beats)?.markers.map((m) => m.sample / rate),
      defaultGrid: defaultGrid(beats).map((s) => s / rate),
    }
  } finally {
    db.close()
  }
}

describe.each(['2.18', '3.0.2'] as const)(
  'repointEngineTracks after a trim, on a %s library',
  (schema) => {
    // Engine keeps every cue, loop and beat as a sample count from the file's first sample.
    // Cutting the lead-in makes the music start that much earlier, so each position has to
    // come down by the same amount or every pad fires late by the length of the cut.
    it('moves every hot cue, the main cue, every loop and both grids earlier by the cut', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      const [result] = await repointEngineTracks(lib.dir, [
        { from: lib.oldFile, to: lib.newFile, engineShift: { trimmedMs: TRIM_MS } },
      ])
      expect(result).toEqual({ written: true, id: '1' })
      const after = await positionsOf(lib)
      const cut = TRIM_MS / 1000
      expect(after.rate).toBe(RATE)
      expect(after.hot).toEqual([
        0,
        expect.closeTo(HOT_SEC[1] - cut, 6),
        expect.closeTo(HOT_SEC[2] - cut, 6),
        null,
        null,
        null,
        null,
        null,
      ])
      expect(after.main).toEqual([expect.closeTo(MAIN_SEC[0] - cut, 6), 0])
      expect(after.mainAdjusted).toBe(1)
      expect(after.loops).toEqual([
        [expect.closeTo(LOOP_SEC[0] - cut, 6), expect.closeTo(LOOP_SEC[1] - cut, 6)],
        [-1, -1],
      ])
      expect(after.grid).toEqual(before.grid?.map((s) => expect.closeTo(s - cut, 6)))
      expect(after.defaultGrid).toEqual(before.defaultGrid.map((s) => expect.closeTo(s - cut, 6)))
      expect(after.lengthSec).toBeCloseTo(before.lengthSec - cut, 4)
      expect(after.gridLengthSec).toBeCloseTo(before.gridLengthSec - cut, 4)
    })

    // A conversion that also resamples leaves Engine's sample counts describing the old
    // rate: each position is rewritten at the new one, and the rate Engine reads them by
    // with it.
    it('rewrites every position at the converted file’s sample rate', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      await repointEngineTracks(lib.dir, [
        {
          from: lib.oldFile,
          to: lib.newFile,
          engineShift: { trimmedMs: TRIM_MS, sampleRateHz: 48000 },
        },
      ])
      const after = await positionsOf(lib)
      const cut = TRIM_MS / 1000
      expect(after.rate).toBe(48000)
      expect(after.gridRate).toBe(48000)
      expect(after.hot?.slice(0, 3)).toEqual([
        0,
        expect.closeTo(HOT_SEC[1] - cut, 6),
        expect.closeTo(HOT_SEC[2] - cut, 6),
      ])
      expect(after.loops?.[0]).toEqual([
        expect.closeTo(LOOP_SEC[0] - cut, 6),
        expect.closeTo(LOOP_SEC[1] - cut, 6),
      ])
      expect(after.grid).toEqual(before.grid?.map((s) => expect.closeTo(s - cut, 6)))
      expect(after.lengthSec).toBeCloseTo(before.lengthSec - cut, 4)
    })

    it('a resample with no trim keeps every position where it was in time', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      await repointEngineTracks(lib.dir, [
        {
          from: lib.oldFile,
          to: lib.newFile,
          engineShift: { trimmedMs: 0, sampleRateHz: 96000 },
        },
      ])
      const after = await positionsOf(lib)
      expect(after.rate).toBe(96000)
      expect(after.hot).toEqual(before.hot?.map((s) => (s === null ? null : expect.closeTo(s, 6))))
      expect(after.grid).toEqual(before.grid?.map((s) => expect.closeTo(s, 6)))
    })

    // Engine's length is the one figure a cut at the end changes, and only the conversion
    // knows it exactly: the head cut alone leaves it long by whatever the end trim took.
    it('records the length the conversion wrote, end trim included', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      await repointEngineTracks(lib.dir, [
        {
          from: lib.oldFile,
          to: lib.newFile,
          engineShift: { trimmedMs: 0, sampleCount: RATE * 50 },
        },
      ])
      const after = await positionsOf(lib)
      expect(after.lengthSec).toBe(50)
      expect(after.gridLengthSec).toBe(50)
      expect(after.hot).toEqual(before.hot)
      expect(after.grid).toEqual(before.grid)
    })

    it('records the exact length at the new rate when a trim also resamples', async () => {
      const lib = await analysedLibrary(schema)
      await repointEngineTracks(lib.dir, [
        {
          from: lib.oldFile,
          to: lib.newFile,
          engineShift: { trimmedMs: TRIM_MS, sampleRateHz: 48000, sampleCount: 2_000_003 },
        },
      ])
      const after = await positionsOf(lib)
      expect(after.lengthSec * 48000).toBeCloseTo(2_000_003, 6)
      expect(after.gridLengthSec * 48000).toBeCloseTo(2_000_003, 6)
    })

    // The retry and the queue hand the same move again. The row already left the old path
    // with the first write, so the second finds nothing to move and nothing shifts twice.
    it('shifts once when the same move is handed again', async () => {
      const lib = await analysedLibrary(schema)
      const move = { from: lib.oldFile, to: lib.newFile, engineShift: { trimmedMs: TRIM_MS } }
      await repointEngineTracks(lib.dir, [move])
      const once = await positionsOf(lib)
      const [again] = await repointEngineTracks(lib.dir, [move])
      expect(again).toEqual({ written: false, reason: 'no-match' })
      expect(await positionsOf(lib)).toEqual(once)
    })

    // A same-format reconvert with a trim rewrites the file on its own path, so the row never
    // moves and the path alone cannot say whether the cut already came off. The size Engine
    // recorded can: the source's size before the write means the shift is still owed, and the
    // write swaps it for the new one, so a retry or a queued apply finds it and shifts nothing.
    it('shifts a row rewritten in place once, while it still has the source’s size', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      await writeFile(lib.oldFile, Buffer.alloc(4321))
      const move = {
        from: lib.oldFile,
        to: lib.oldFile,
        fromBytes: 100,
        engineShift: { trimmedMs: TRIM_MS },
      }
      const [result] = await repointEngineTracks(lib.dir, [move])
      expect(result).toEqual({ written: true, id: '1' })
      const once = await positionsOf(lib)
      expect(once.hot?.[1]).toBeCloseTo(HOT_SEC[1] - TRIM_MS / 1000, 6)
      expect(once.grid).toEqual(before.grid?.map((s) => expect.closeTo(s - TRIM_MS / 1000, 6)))
      const db = await openDb(lib.dbPath)
      expect(one(db, 'SELECT path, fileBytes FROM Track')).toEqual({
        path: '../music/old.mp3',
        fileBytes: 4321,
      })
      db.close()
      const [again] = await repointEngineTracks(lib.dir, [move])
      expect(again).toEqual({ written: false, reason: 'no-match' })
      expect(await positionsOf(lib)).toEqual(once)
    })

    it('leaves a row rewritten in place alone when nothing says the cut is still owed', async () => {
      const lib = await analysedLibrary(schema)
      const before = await positionsOf(lib)
      const bytes = await readFile(lib.dbPath)
      const [result] = await repointEngineTracks(lib.dir, [
        { from: lib.oldFile, to: lib.oldFile, engineShift: { trimmedMs: TRIM_MS } },
      ])
      expect(result).toEqual({ written: false, reason: 'no-match' })
      expect(await positionsOf(lib)).toEqual(before)
      expect(await readFile(lib.dbPath)).toEqual(bytes)
    })

    // A loop is a length as much as a place: one set inside the lead-in, or across its end,
    // collapsed onto the new start would be a zero-length loop Engine cannot play. It lands on
    // the new start and keeps its length, as Traktor's loops do.
    it('keeps the length of a loop that started inside the cut', async () => {
      const lib = await analysedLibrary(schema)
      const loop = (start: number, end: number) => ({
        label: '',
        start: start * RATE,
        end: end * RATE,
        startSet: true,
        endSet: true,
        argb: 0xff00cc00,
      })
      const db = await openDb(lib.dbPath)
      db.run('UPDATE PerformanceData SET loops = ? WHERE trackId = 1', [
        encodeLoops([loop(0.5, 1.5), loop(1.5, 3.5)]),
      ])
      await writeFile(lib.dbPath, db.export())
      db.close()
      await repointEngineTracks(lib.dir, [
        { from: lib.oldFile, to: lib.newFile, engineShift: { trimmedMs: TRIM_MS } },
      ])
      expect((await positionsOf(lib)).loops).toEqual([
        [0, expect.closeTo(1, 6)],
        [0, expect.closeTo(2, 6)],
      ])
    })

    // Engine can hold a row's cues and grid without its trackData. The grid carries the same
    // rate, so the cues still have a unit to move in, and missing it would leave them late.
    it('moves the cues of a row with no trackData by the rate its grid carries', async () => {
      const lib = await analysedLibrary(schema)
      const db = await openDb(lib.dbPath)
      db.run('UPDATE PerformanceData SET trackData = NULL WHERE trackId = 1')
      await writeFile(lib.dbPath, db.export())
      db.close()
      await repointEngineTracks(lib.dir, [
        { from: lib.oldFile, to: lib.newFile, engineShift: { trimmedMs: TRIM_MS } },
      ])
      const after = await openDb(lib.dbPath)
      const row = one(after, 'SELECT trackData, quickCues FROM PerformanceData WHERE trackId = 1')
      after.close()
      expect(row.trackData).toBeNull()
      const cues = decodeQuickCues(inflateEngineBlob(row.quickCues as Uint8Array))
      expect(cues?.slots.map((s) => (s.cue ? s.cue.sample / RATE : null)).slice(0, 3)).toEqual([
        0,
        expect.closeTo(HOT_SEC[1] - TRIM_MS / 1000, 6),
        expect.closeTo(HOT_SEC[2] - TRIM_MS / 1000, 6),
      ])
    })

    // The overview is the whole-track waveform Engine draws the cues over, one entry per
    // fixed run of samples. Left alone after a cut, the cues sit on the right beats while the
    // drawing under them still shows the lead-in; after a resample its run is counted at the
    // old rate and the drawing stretches.
    it('drops the overview’s entries for the cut and counts its run at the new rate', async () => {
      const lib = await analysedLibrary(schema)
      const head = Buffer.alloc(24)
      head.writeBigInt64BE(10n, 0)
      head.writeBigInt64BE(10n, 8)
      head.writeDoubleBE(RATE / 2, 16)
      const entries = Array.from({ length: 10 }, (_, i) => [i, i + 1, i + 2]).flat()
      const raw = Buffer.concat([head, Buffer.from(entries), Buffer.from([9, 10, 11])])
      const db = await openDb(lib.dbPath)
      db.run('UPDATE PerformanceData SET overviewWaveFormData = ? WHERE trackId = 1', [
        deflateEngineBlob(raw),
      ])
      await writeFile(lib.dbPath, db.export())
      db.close()
      await repointEngineTracks(lib.dir, [
        {
          from: lib.oldFile,
          to: lib.newFile,
          engineShift: { trimmedMs: TRIM_MS, sampleRateHz: 48000 },
        },
      ])
      const after = await openDb(lib.dbPath)
      const overview = inflateEngineBlob(
        one(after, 'SELECT overviewWaveFormData FROM PerformanceData WHERE trackId = 1')
          .overviewWaveFormData as Uint8Array,
      )
      after.close()
      expect(Number(overview.readBigInt64BE(0))).toBe(6)
      expect(Number(overview.readBigInt64BE(8))).toBe(6)
      expect(overview.readDoubleBE(16)).toBeCloseTo((RATE / 2) * (48000 / RATE), 6)
      expect(decodeOverview(overview)).toEqual({
        entries: [4, 5, 6, 7, 8, 9].map((i) => [i, i + 1, i + 2]),
        max: [9, 10, 11],
      })
    })

    // A blob Surco cannot read is kept as Engine wrote it: guessing at its layout could only
    // corrupt it, and the path still has to follow the file.
    it('moves the row and leaves blobs it cannot read as they were', async () => {
      const lib = await library(schema)
      const [result] = await repointEngineTracks(lib.dir, [
        { from: lib.oldFile, to: lib.newFile, engineShift: { trimmedMs: TRIM_MS } },
      ])
      expect(result).toEqual({ written: true, id: '1' })
      const perf = performance(await openDb(lib.dbPath), schema)
      expect(perf.quickCues).toEqual(CUES)
      expect(perf.beatData).toEqual(GRID)
    })
  },
)

// Measured on 23 analysed rows of a real m.db on 31/10: Engine shows the length rounded to the
// nearest second of what its own trackData holds.
describe('engineLengthOf', () => {
  it.each([
    [9609216, 44100, 218],
    [13248522, 44100, 300],
    [14751744, 44100, 335],
  ])('%i samples at %i Hz → %i s', (count, rate, sec) => {
    expect(engineLengthOf(count, rate)).toBe(sec)
  })
})

// The damage review repairs a row in place: from and to are the same file and its size never
// changes, so the only proof the repair has not landed yet is the trackData the scan read.
describe.each(['2.18', '3.0.2'] as const)('a damage repair on a %s library', (schema) => {
  const scanned = { sampleRate: RATE, sampleCount: RATE * 60 }

  async function lengthOf(lib: Library): Promise<unknown> {
    const db = await openDb(lib.dbPath)
    try {
      return one(db, 'SELECT length FROM Track WHERE id = 1').length
    } finally {
      db.close()
    }
  }

  const repair = (lib: Library, extra: object) => ({
    from: lib.oldFile,
    to: lib.oldFile,
    fromBytes: 100,
    expectTrackData: scanned,
    ...extra,
  })

  it('sets the length a repair hands', async () => {
    const lib = await analysedLibrary(schema)
    const [result] = await repointEngineTracks(lib.dir, [repair(lib, { length: 60 })])
    expect(result).toEqual({ written: true, id: '1' })
    expect(await lengthOf(lib)).toBe(60)
  })

  it('writes nothing when the row no longer holds the trackData the scan read', async () => {
    const lib = await analysedLibrary(schema)
    const bytes = await readFile(lib.dbPath)
    const [result] = await repointEngineTracks(lib.dir, [
      repair(lib, {
        expectTrackData: { sampleRate: 48000, sampleCount: 48000 * 60 },
        engineShift: { trimmedMs: 0, sampleRateHz: 48000, sampleCount: 48000 * 60 },
      }),
    ])
    expect(result).toEqual({ written: false, reason: 'no-match' })
    expect(await readFile(lib.dbPath)).toEqual(bytes)
  })

  it('moves the positions once when the same repair is handed again', async () => {
    const lib = await analysedLibrary(schema)
    const move = repair(lib, {
      engineShift: { trimmedMs: 0, sampleRateHz: 48000, sampleCount: 48000 * 60 },
    })
    expect((await repointEngineTracks(lib.dir, [move]))[0]).toEqual({ written: true, id: '1' })
    const once = await positionsOf(lib)
    expect(once.rate).toBe(48000)
    expect((await repointEngineTracks(lib.dir, [move]))[0]).toEqual({
      written: false,
      reason: 'no-match',
    })
    expect(await positionsOf(lib)).toEqual(once)
  })
})
