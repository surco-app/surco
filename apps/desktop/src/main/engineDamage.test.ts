import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { describe, expect, it, vi } from 'vitest'
import type { TrashEntry } from '../shared/types'
import { ENGINE_3_SCHEMA } from './engine3Fixture'
import { judgeEngineRow, scanEngineDamage } from './engineDamage'
import { quickCuesBlob, trackDataBlob } from './enginePerformanceFixture'

const row = (
  sampleRate: number,
  sampleCount: number,
  length = Math.round(sampleCount / sampleRate),
) => ({
  sampleRate,
  sampleCount,
  length,
})

// Engine DJ counts every position in samples of the file it analysed. A conversion that cut
// the lead-in or changed the rate without telling Engine left every cue off, and only what
// is proven moves them back: the rate the file has now, or where it starts in a backup.
describe('judgeEngineRow', () => {
  it('rescales the positions to the rate the file has now', () => {
    expect(
      judgeEngineRow(row(48000, 14400000), { sampleRate: 44100, durationSec: 300 }, null, true),
    ).toEqual({
      kind: 'engine-cues',
      certainty: 'sure',
      trimmedMs: 0,
      sampleRateHz: 44100,
      cuesKept: true,
    })
  })

  it('moves the positions by where the audio starts inside the backup', () => {
    expect(
      judgeEngineRow(
        row(44100, 13230000),
        { sampleRate: 44100, durationSec: 298.76 },
        { id: 'b1', trashedAt: 5, durationSec: 300, headMs: 1240 },
        true,
      ),
    ).toEqual({
      kind: 'engine-cues',
      certainty: 'sure',
      trimmedMs: 1240,
      backup: { id: 'b1', trashedAt: 5 },
      cuesKept: true,
    })
  })

  // Engine keeps its analysis when the DJ moves a cue by hand, so the rate and the length
  // alone cannot tell a cue the bug left behind from one the DJ already put right.
  it.each<[boolean | null, string]>([
    [false, 'the cues changed since the library copy'],
    [null, 'no library copy holds the row'],
  ])('is only likely when %s (%s)', (cuesKept, _why) => {
    expect(
      judgeEngineRow(row(48000, 14400000), { sampleRate: 44100, durationSec: 300 }, null, cuesKept),
    ).toMatchObject({ kind: 'engine-cues', certainty: 'likely', cuesKept })
  })

  it('only warns when no backup holds the trimmed audio', () => {
    const j = judgeEngineRow(row(44100, 13230000), { sampleRate: 44100, durationSec: 298.76 }, null)
    expect(j).toEqual({ kind: 'engine-cues', unrepairable: true, missingSec: 1.24 })
  })

  it('only warns when the backup says the audio starts later than the cut allows', () => {
    const j = judgeEngineRow(
      row(44100, 13230000),
      { sampleRate: 44100, durationSec: 298.76 },
      { id: 'b1', trashedAt: 5, durationSec: 300, headMs: 1300 },
    )
    expect(j).toMatchObject({ unrepairable: true })
  })

  it('fixes only the length when trackData moved without it', () => {
    expect(
      judgeEngineRow(row(44100, 13230000, 299), { sampleRate: 44100, durationSec: 300 }, null),
    ).toEqual({ kind: 'engine-length', certainty: 'sure', trimmedMs: 0 })
  })

  it('leaves a healthy row alone', () => {
    expect(
      judgeEngineRow(row(44100, 13230000), { sampleRate: 44100, durationSec: 300 }, null),
    ).toBeNull()
  })

  it('leaves an MP3 whose decoders disagree by a few frames alone', () => {
    expect(
      judgeEngineRow(row(44100, 13230000), { sampleRate: 44100, durationSec: 300.05 }, null),
    ).toBeNull()
  })
})

async function library(
  rows: { path: string; rate: number; count: number; length?: number; cues?: Buffer }[],
) {
  const require = createRequire(import.meta.url)
  const buf = await readFile(require.resolve('sql.js/dist/sql-wasm.wasm'))
  const SQL = await initSqlJs({
    wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })
  const root = await mkdtemp(join(tmpdir(), 'surco-engine-damage-'))
  const dir = join(root, 'Engine Library')
  await mkdir(join(dir, 'Database2'), { recursive: true })
  const db = new SQL.Database()
  db.exec(ENGINE_3_SCHEMA)
  for (const r of rows) {
    db.run(
      "INSERT INTO Track (path, filename, fileType, fileBytes, length) VALUES (?, 'x', 'mp3', 1234, ?)",
      [r.path, r.length ?? Math.round(r.count / r.rate)],
    )
    const id = db.exec('SELECT last_insert_rowid()')[0].values[0][0]
    db.run('UPDATE PerformanceData SET trackData = ?, quickCues = ? WHERE trackId = ?', [
      trackDataBlob(r.rate, r.count),
      r.cues ?? null,
      id,
    ])
  }
  await writeFile(join(dir, 'Database2', 'm.db'), db.export())
  db.close()
  return { dir, music: join(root, 'music') }
}

const deps = (over: Partial<Parameters<typeof scanEngineDamage>[2]> = {}) => ({
  probe: vi.fn(async () => ({ sampleRate: 44100, durationSec: 300 })),
  backups: vi.fn(async (): Promise<TrashEntry[]> => []),
  headOffsetMs: vi.fn(async () => null),
  durationOf: vi.fn(async () => null),
  ...over,
})

describe('scanEngineDamage', () => {
  it('judges the one row each loaded file has', async () => {
    const lib = await library([{ path: '../music/a.mp3', rate: 48000, count: 14400000 }])
    const [found, ...rest] = await scanEngineDamage([join(lib.music, 'a.mp3')], lib.dir, deps())
    expect(rest).toEqual([])
    expect(found).toMatchObject({
      path: join(lib.music, 'a.mp3'),
      fileBytes: 1234,
      trackData: { sampleRate: 48000, sampleCount: 14400000 },
      judgement: { kind: 'engine-cues', sampleRateHz: 44100 },
    })
  })

  it('says when Engine keeps no size for the row', async () => {
    const lib = await library([{ path: '../music/a.mp3', rate: 48000, count: 14400000 }])
    const buf = await readFile(createRequire(import.meta.url).resolve('sql.js/dist/sql-wasm.wasm'))
    const SQL = await initSqlJs({
      wasmBinary: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    })
    const db = new SQL.Database(await readFile(join(lib.dir, 'Database2', 'm.db')))
    db.run('UPDATE Track SET fileBytes = NULL')
    await writeFile(join(lib.dir, 'Database2', 'm.db'), db.export())
    db.close()
    const [found] = await scanEngineDamage([join(lib.music, 'a.mp3')], lib.dir, deps())
    expect(found.fileBytes).toBeNull()
  })

  it('matches a row Engine stored with a decomposed name', async () => {
    const lib = await library([
      { path: '../music/Canción.mp3'.normalize('NFD'), rate: 48000, count: 14400000 },
    ])
    expect(await scanEngineDamage([join(lib.music, 'Canción.mp3')], lib.dir, deps())).toHaveLength(
      1,
    )
  })

  it('skips a file Engine holds twice', async () => {
    const lib = await library([
      { path: '../music/Canción.mp3'.normalize('NFD'), rate: 48000, count: 14400000 },
      { path: '../music/Canción.mp3', rate: 48000, count: 14400000 },
    ])
    expect(await scanEngineDamage([join(lib.music, 'Canción.mp3')], lib.dir, deps())).toEqual([])
  })

  it('measures the head only against a backup as long as the row', async () => {
    const lib = await library([{ path: '../music/a.mp3', rate: 44100, count: 13230000 }])
    const path = join(lib.music, 'a.mp3')
    const entry = (id: string, trashedAt: number): TrashEntry => ({
      id,
      name: 'a.mp3',
      originalPath: path,
      storedPath: `/trash/${id}`,
      bytes: 1,
      trashedAt,
      reason: 'replaced',
    })
    const headOffsetMs = vi.fn(async () => 1240)
    const found = await scanEngineDamage(
      [path],
      lib.dir,
      deps({
        probe: vi.fn(async () => ({ sampleRate: 44100, durationSec: 298.76 })),
        backups: vi.fn(async () => [entry('short', 9), entry('full', 5)]),
        durationOf: vi.fn(async (p: string) => (p === '/trash/full' ? 300 : 298.76)),
        headOffsetMs,
      }),
    )
    expect(headOffsetMs).toHaveBeenCalledTimes(1)
    expect(headOffsetMs.mock.calls[0]).toEqual(['/trash/full', path, expect.any(Number)])
    expect(found[0].judgement).toMatchObject({
      trimmedMs: 1240,
      backup: { id: 'full', trashedAt: 5 },
    })
  })
})

// The library copy Surco took before the conversion holds the cues as the DJ set them on the
// old file. Still the same now, nobody moved them since: the repair is sure.
describe('scanEngineDamage against the library copies', () => {
  const ROW = { path: '../music/a.mp3', rate: 48000, count: 14400000 }
  const cues = (sample: number) => quickCuesBlob([{ label: 'Drop', sample, argb: 0xffcc0000 }])

  async function copyOf(row: typeof ROW & { cues: Buffer }) {
    const copy = await library([row])
    return join(copy.dir, 'Database2', 'm.db')
  }

  // A resample leaves nothing in Copias that dates the conversion, so no copy can be told
  // apart from one taken after the DJ moved the cues by hand.
  it('is only likely for a resample, even with a copy that matches', async () => {
    const lib = await library([{ ...ROW, cues: cues(96000) }])
    const dbPath = await copyOf({ ...ROW, cues: cues(96000) })
    const [found] = await scanEngineDamage(
      [join(lib.music, 'a.mp3')],
      lib.dir,
      deps({ copies: async () => [{ takenAt: 1, dbPath }] }),
    )
    expect(found.judgement).toMatchObject({ certainty: 'likely', cuesKept: null })
  })

  it.each([
    [96000, 'sure'],
    [97000, 'likely'],
  ])('a trim with a copy from before it holding the cue at %i is %s', async (inCopy, certainty) => {
    const trimmed = { path: '../music/a.mp3', rate: 44100, count: 13230000 }
    const lib = await library([{ ...trimmed, cues: cues(96000) }])
    const dbPath = await copyOf({ ...trimmed, cues: cues(inCopy) })
    const path = join(lib.music, 'a.mp3')
    const [found] = await scanEngineDamage(
      [path],
      lib.dir,
      deps({
        probe: vi.fn(async () => ({ sampleRate: 44100, durationSec: 298.76 })),
        backups: vi.fn(async () => [
          {
            id: 'b1',
            name: 'a.mp3',
            originalPath: path,
            storedPath: '/trash/b1',
            bytes: 1,
            trashedAt: 5,
            reason: 'replaced',
          } as TrashEntry,
        ]),
        durationOf: vi.fn(async () => 300),
        headOffsetMs: vi.fn(async () => 1240),
        copies: async () => [
          { takenAt: 1, dbPath },
          { takenAt: 9, dbPath: join(lib.dir, 'Database2', 'm.db') },
        ],
      }),
    )
    expect(found.judgement).toMatchObject({ certainty, trimmedMs: 1240 })
  })
})
