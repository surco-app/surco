import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))
vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { deflateEngineBlob, encodeLoops, inflateEngineBlob } from './engineBlobs'
import {
  analysedTrack,
  beatDataBlob,
  MAIN_CUE_TAIL,
  quickCuesBlob,
  trackDataBlob,
} from './enginePerformanceFixture'
import { type EngineDb, openEngineDb } from './enginePlaylists'
import { engineDbPath, writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { repointEngineTracks } from './engineRepoint'
import { pathKey } from './libraryPathKey'
import {
  checkEngine,
  type EngineBefore,
  type EngineExpect,
  snapshotEngineRow,
} from './verifyEngine'

const FROM = '/Volumes/Public/Musica/Artist/Title.aiff'
const TO = '/Volumes/Public/Musica/Artist/Title.wav'
const SIZE = 52_000_123
const key = pathKey({ realPath: (p) => p, homeMusicDir: '/nowhere' })
const CUES = [
  { label: 'Drop', sample: 44100 * 30, argb: 0xffcc0000 },
  { label: 'Out', sample: 44100 * 50, argb: 0xff00cc00 },
]
const LOOPS = Buffer.from('0000000801020304', 'hex')

const opened: EngineDb[] = []
afterEach(() => {
  for (const db of opened.splice(0)) db.close()
})

// A library the way the user's is: m.db under <library>/Database2, music on the NAS, so
// each stored path climbs out of the library folder with "../" up to /Volumes.
function library(paths: string[] = [FROM]): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'surco-verifyengine-')), 'Engine Library')
  const db = writeEngineLibraryFixture(dir, {
    tracks: paths.map((p, i) => ({ id: i + 1, path: relative(dir, p) })),
    playlists: [],
    entities: [],
    performance: paths.map((_, i) => analysedTrack(i + 1, CUES)),
  })
  db.prepare(
    "UPDATE Track SET fileType = 'aiff', fileBytes = 40000000, filename = 'Title.aiff'",
  ).run()
  db.prepare('UPDATE PerformanceData SET loops = ?').run(LOOPS)
  db.close()
  return dir
}

function write(dir: string, sql: string, ...args: unknown[]) {
  const db = new Database(engineDbPath(dir))
  db.prepare(sql).run(...args)
  db.close()
}

// What engineRepoint.ts writes: the file columns only.
const repoint = (dir: string, id: number, to = TO, size = SIZE) =>
  write(
    dir,
    'UPDATE Track SET path = ?, filename = ?, fileType = ?, fileBytes = ? WHERE id = ?',
    relative(dir, to),
    to.slice(to.lastIndexOf('/') + 1),
    to.slice(to.lastIndexOf('.') + 1),
    size,
    id,
  )

const readOnly = (dir: string) => {
  const db = openEngineDb(dir)
  if (!db) throw new Error('fixture did not open read-only')
  opened.push(db)
  return db
}

const snapshot = (dir: string, from = FROM) => snapshotEngineRow(readOnly(dir), dir, from, key)

const expectFor = (before: EngineBefore, over: Partial<EngineExpect> = {}): EngineExpect => ({
  from: FROM,
  to: TO,
  samplesKept: true,
  before,
  size: SIZE,
  ...over,
})

const checkOne = (dir: string, e: EngineExpect) => checkEngine(readOnly(dir), dir, [e], key)

const idOf = (b: EngineBefore) => (typeof b === 'object' ? b.id : b)

const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex')

describe('snapshotEngineRow', () => {
  // The "before" is the only way to say the cues, the grid and the loops survived.
  it('reads the row id and a digest of each performance blob', () => {
    const dir = library()
    const perf = analysedTrack(1, CUES)
    expect(snapshot(dir)).toEqual({
      id: 1,
      quickCues: sha1(perf.quickCues as Buffer),
      beatData: sha1(perf.beatData as Buffer),
      loops: sha1(LOOPS),
      positions: {
        quickCues: [30, 50, null, null, null, null, null, null, 9695700 / 44100, 18900 / 44100],
        beatData: [-0.5, 59.5, -0.5, 59.5],
        loops: null,
      },
    })
  })

  // Absent means Engine does not have the track, so there is nothing there to check.
  it('a file the library does not have is absent', () => {
    expect(snapshot(library(), '/Volumes/Public/Musica/Other.aiff')).toBe('absent')
  })

  it('two rows on the file are ambiguous, not absent', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    write(dir, 'UPDATE Track SET path = ? WHERE id = 2', `${relative(dir, FROM)}/../Title.aiff`)
    expect(snapshot(dir)).toBe('ambiguous')
  })
})

describe('checkEngine', () => {
  // The whole point of a repoint: the same row, now on the WAV, with every cue, beat and
  // loop the DJ set still there.
  it('a moved row with identical performance blobs is ok', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    expect(checkOne(dir, expectFor(before))).toEqual([
      { place: 'engine', state: 'ok', detail: { key: 'engineOk', params: { format: 'WAV' } } },
    ])
  })

  it('a row still on the old path is engineStillOld', () => {
    const dir = library()
    const before = snapshot(dir)
    expect(checkOne(dir, expectFor(before))).toEqual([
      {
        place: 'engine',
        state: 'mismatch',
        detail: { key: 'engineStillOld', params: { format: 'AIFF' } },
      },
    ])
  })

  it('a row on the new path with the old fileType is engineStillOld', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(dir, "UPDATE Track SET fileType = 'aiff' WHERE id = 1")
    expect(checkOne(dir, expectFor(before))[0].detail).toEqual({
      key: 'engineStillOld',
      params: { format: 'AIFF' },
    })
  })

  it("a fileBytes that is not the file's is engineSizeDiffers", () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1, TO, SIZE - 1)
    expect(checkOne(dir, expectFor(before))[0]).toEqual({
      place: 'engine',
      state: 'mismatch',
      detail: { key: 'engineSizeDiffers' },
    })
  })

  // Kept samples mean every cue still lands on the same beat; a different blob is a cue
  // the DJ set and lost.
  it('a changed quickCues blob on a sample-kept conversion is enginePerformanceChanged', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(
      dir,
      'UPDATE PerformanceData SET quickCues = ? WHERE trackId = 1',
      quickCuesBlob(CUES.slice(0, 1)),
    )
    expect(checkOne(dir, expectFor(before))[0]).toEqual({
      place: 'engine',
      state: 'mismatch',
      detail: { key: 'enginePerformanceChanged', params: { field: 'quickCues' } },
    })
  })

  it('a changed beatData blob on a sample-kept conversion is enginePerformanceChanged', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(
      dir,
      'UPDATE PerformanceData SET beatData = ? WHERE trackId = 1',
      beatDataBlob(44100, 44100 * 60, [
        [0, 0],
        [44100 * 60, 120],
      ]),
    )
    expect(checkOne(dir, expectFor(before))[0].detail).toEqual({
      key: 'enginePerformanceChanged',
      params: { field: 'beatData' },
    })
  })

  it('cleared loops on a sample-kept conversion are enginePerformanceChanged', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(dir, 'UPDATE PerformanceData SET loops = NULL WHERE trackId = 1')
    expect(checkOne(dir, expectFor(before))[0].detail).toEqual({
      key: 'enginePerformanceChanged',
      params: { field: 'loops' },
    })
  })

  // A re-encode moves the audio, so Engine has to analyse it again: a new grid is the
  // intended state there, not a loss.
  it('a changed beatData after a reencode is ok', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(
      dir,
      'UPDATE PerformanceData SET beatData = ? WHERE trackId = 1',
      beatDataBlob(44100, 44100 * 60, [
        [0, 0],
        [44100 * 60, 120],
      ]),
    )
    expect(checkOne(dir, expectFor(before, { samplesKept: false }))[0].state).toBe('ok')
  })

  // A re-encode may move the cues, never wipe them: the DJ set them and Engine has no
  // other copy.
  it.each(['quickCues', 'beatData', 'loops'])(
    'cleared %s after a reencode is enginePerformanceChanged',
    (field) => {
      const dir = library()
      const before = snapshot(dir)
      repoint(dir, 1)
      write(dir, `UPDATE PerformanceData SET ${field} = NULL WHERE trackId = 1`)
      expect(checkOne(dir, expectFor(before, { samplesKept: false }))[0]).toEqual({
        place: 'engine',
        state: 'mismatch',
        detail: { key: 'enginePerformanceChanged', params: { field } },
      })
    },
  )

  it('a reencode of a track with no cues and no grid is ok', () => {
    const dir = library()
    write(dir, 'UPDATE PerformanceData SET quickCues = NULL, beatData = NULL, loops = NULL')
    const before = snapshot(dir)
    repoint(dir, 1)
    expect(checkOne(dir, expectFor(before, { samplesKept: false }))[0].state).toBe('ok')
  })

  it('a row with no fileType is engineNoFileType', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(dir, 'UPDATE Track SET fileType = NULL WHERE id = 1')
    expect(checkOne(dir, expectFor(before))[0].detail).toEqual({ key: 'engineNoFileType' })
  })

  // Engine keeps every path relative to the library folder: compared raw, nothing would
  // ever match the absolute file Surco wrote.
  it('a relative Track.path resolves against the library dir', () => {
    const dir = library()
    const music = join(dir, '..', 'music')
    const from = join(music, 'Title.aiff')
    const to = join(music, 'Title.wav')
    write(dir, 'UPDATE Track SET path = ? WHERE id = 1', '../music/Title.aiff')
    const before = snapshot(dir, from)
    expect(idOf(before)).toBe(1)
    repoint(dir, 1, to)
    expect(checkOne(dir, expectFor(before, { from, to }))[0].state).toBe('ok')
  })

  // macOS and SMB hand Surco NFD names; Engine keeps whatever it was given.
  it('an NFD Track.path matches an NFC file', () => {
    const from = '/Volumes/Public/Música/Artist/Café.aiff'.normalize('NFC')
    const to = '/Volumes/Public/Música/Artist/Café.wav'.normalize('NFC')
    const dir = library([from.normalize('NFD')])
    const before = snapshot(dir, from)
    expect(idOf(before)).toBe(1)
    repoint(dir, 1, to.normalize('NFD'))
    expect(checkOne(dir, expectFor(before, { from, to }))[0].state).toBe('ok')
  })

  it('a row on the ~/Music/Music spelling of the file is the same file', () => {
    const link = '/Users/dj/Music/Music'
    const linked = pathKey({
      realPath: (p) => (p === link ? '/Volumes/Public/Musica' : p),
      homeMusicDir: link,
    })
    const dir = library([`${link}/Artist/Title.aiff`])
    const before = snapshotEngineRow(readOnly(dir), dir, FROM, linked)
    expect(idOf(before)).toBe(1)
    repoint(dir, 1, `${link}/Artist/Title.wav`)
    expect(checkEngine(readOnly(dir), dir, [expectFor(before)], linked)[0].state).toBe('ok')
  })

  // Two rows on one file: repointing one leaves the other on the old file, so it can never
  // read as done.
  it('two rows on the new file is engineAmbiguous, never ok', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    const before = snapshot(dir)
    repoint(dir, 1)
    write(dir, 'UPDATE Track SET path = ? WHERE id = 2', `${relative(dir, TO)}/../Title.wav`)
    expect(checkOne(dir, expectFor(before))[0]).toEqual({
      place: 'engine',
      state: 'mismatch',
      detail: { key: 'engineAmbiguous', params: { count: 2 } },
    })
  })

  it('two rows still on the source file are engineAmbiguous', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    write(dir, 'UPDATE Track SET path = ? WHERE id = 2', `${relative(dir, FROM)}/../Title.aiff`)
    expect(checkOne(dir, expectFor('ambiguous'))[0].detail).toEqual({
      key: 'engineAmbiguous',
      params: { count: 2 },
    })
  })

  it('a row on neither file is engineMissing', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1, '/Volumes/Public/Elsewhere/Title.wav')
    expect(checkOne(dir, expectFor(before))[0]).toEqual({
      place: 'engine',
      state: 'mismatch',
      detail: { key: 'engineMissing' },
    })
  })

  it('another row on the file than the one photographed is engineOtherRow', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    const before = snapshot(dir)
    write(dir, 'DELETE FROM Track WHERE id = 1')
    repoint(dir, 2)
    expect(checkOne(dir, expectFor(before))[0].detail).toEqual({ key: 'engineOtherRow' })
  })

  // The Engine DJ destination adds a row for a source Engine did not have: no photo to
  // hold it to, only that the row is there and plays the written file.
  it('a row the add created on the written file is ok', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    repoint(dir, 2)
    expect(checkOne(dir, expectFor('absent', { added: true }))[0]).toEqual({
      place: 'engine',
      state: 'ok',
      detail: { key: 'engineOk', params: { format: 'WAV' } },
    })
  })

  it('an add that left no row on the written file is engineMissing', () => {
    const dir = library()
    const e = expectFor('absent', { added: true, from: '/Volumes/Public/Downloads/Title.wav' })
    expect(checkOne(dir, e)[0].detail).toEqual({ key: 'engineMissing' })
  })

  it('an added row whose size is not the file is engineSizeDiffers', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    repoint(dir, 2, TO, SIZE + 1)
    expect(checkOne(dir, expectFor('absent', { added: true }))[0].detail).toEqual({
      key: 'engineSizeDiffers',
    })
  })

  it('an add whose library could not be read before is still unreadable', () => {
    const dir = library([FROM, '/Volumes/Public/Musica/Other.aiff'])
    repoint(dir, 2)
    expect(checkOne(dir, expectFor('unreadable', { added: true }))[0].state).toBe('unreadable')
  })

  // Without the photo there is nothing to compare the cues, grid and loops against. No
  // re-read can take one: the answer is final, and a retry would only read the same.
  it('a repoint with no snapshot is unreadable, never ok', () => {
    const dir = library()
    repoint(dir, 1)
    expect(checkOne(dir, expectFor('absent'))[0]).toEqual({
      place: 'engine',
      state: 'unreadable',
      detail: { key: 'engineUnreadable' },
      final: true,
    })
  })

  // A failed read is not "Engine does not have it": the caller must mark the track
  // unreadable rather than skip Engine.
  it('a snapshot that fails to read is unreadable, not absent', () => {
    const dir = library()
    const handle = readOnly(dir)
    opened.splice(opened.indexOf(handle), 1)
    handle.close()
    expect(snapshotEngineRow(handle, dir, FROM, key)).toBe('unreadable')
  })

  it('a check whose snapshot failed is unreadable whatever the row says', () => {
    const dir = library()
    expect(checkOne(dir, expectFor('unreadable'))[0]).toEqual({
      place: 'engine',
      state: 'unreadable',
      detail: { key: 'engineUnreadable' },
      final: true,
    })
  })

  it('a database that fails to read is unreadable', () => {
    const dir = library()
    const handle = readOnly(dir)
    const before = snapshotEngineRow(handle, dir, FROM, key)
    opened.splice(opened.indexOf(handle), 1)
    handle.close()
    expect(checkEngine(handle, dir, [expectFor(before)], key)).toEqual([
      { place: 'engine', state: 'unreadable', detail: { key: 'engineUnreadable' } },
    ])
  })

  // A library still on Engine's older schema keeps no PerformanceData table: the cues
  // cannot be read, which is not the same as intact.
  it('performance data that fails to read is unreadable', () => {
    const dir = library()
    const before = snapshot(dir)
    repoint(dir, 1)
    write(dir, 'DROP TABLE PerformanceData')
    expect(checkOne(dir, expectFor(before))[0]).toEqual({
      place: 'engine',
      state: 'unreadable',
      detail: { key: 'engineUnreadable' },
    })
  })

  it('judges every track of the batch in order', () => {
    const b = '/Volumes/Public/Musica/B.aiff'
    const dir = library([FROM, b])
    const one = snapshot(dir)
    const two = snapshot(dir, b)
    repoint(dir, 1)
    const keys = checkEngine(
      readOnly(dir),
      dir,
      [expectFor(one), expectFor(two, { from: b, to: '/Volumes/Public/Musica/B.wav' })],
      key,
    ).map((c) => c.detail.key)
    expect(keys).toEqual(['engineOk', 'engineStillOld'])
  })

  // The check runs against the user's live library: reading it must never change a byte.
  it('the database opens read-only', () => {
    const dir = library()
    const file = engineDbPath(dir)
    const sha = () => sha1(readFileSync(file))
    const before = snapshot(dir)
    repoint(dir, 1)
    const was = { sha: sha(), mtime: statSync(file).mtimeMs }
    const handle = readOnly(dir)
    expect(handle.readonly).toBe(true)
    expect(checkEngine(handle, dir, [expectFor(before)], key)[0].state).toBe('ok')
    expect(idOf(snapshotEngineRow(handle, dir, TO, key))).toBe(1)
    expect({ sha: sha(), mtime: statSync(file).mtimeMs }).toEqual(was)
  })
})

describe('checkEngine after a conversion that moved the audio', () => {
  const R = 44100
  const CUT = 1.9
  const LOOP = { label: 'Break', startSet: true, endSet: true, argb: 0xff00cc00 }
  const loopsAt = (start: number, end: number) => encodeLoops([{ ...LOOP, start, end }])
  const SIZE_SMALL = 4321
  const FROM_LOCAL = (dir: string) => join(dir, '..', 'Title.aiff')

  // The row as the DJ left it, with a real loop next to the cues and the grid.
  function trimmable(): string {
    const dir = library()
    write(dir, 'UPDATE PerformanceData SET loops = ?', loopsAt(8 * R, 10 * R))
    return dir
  }

  // What a correct write leaves: every position earlier by the cut, counted at `rate`, and a
  // cue inside the cut on the new start.
  function moved(dir: string, cut: number, rate = R) {
    const at = (sample: number) => (sample / R - cut) * rate
    const cue = (sample: number) => Math.max(0, at(sample))
    const tail = Buffer.from(MAIN_CUE_TAIL)
    tail.writeDoubleBE(cue(tail.readDoubleBE(0)), 0)
    tail.writeDoubleBE(cue(tail.readDoubleBE(9)), 9)
    write(
      dir,
      'UPDATE PerformanceData SET trackData = ?, beatData = ?, quickCues = ?, loops = ?',
      trackDataBlob(rate, Math.round(at(R * 60))),
      beatDataBlob(rate, at(R * 60), [
        [at(-22050), -1],
        [at(R * 60 - 22050), 119],
      ]),
      quickCuesBlob(
        CUES.map((c) => ({ ...c, sample: cue(c.sample) })),
        tail,
      ),
      loopsAt(cue(8 * R), cue(10 * R)),
    )
  }

  const trimmedBy = (cut: number, sampleRateHz?: number) =>
    ({
      samplesKept: false,
      shift: { trimmedMs: cut * 1000, ...(sampleRateHz ? { sampleRateHz } : {}) },
    }) as const

  it('cues, grid and loops moved earlier by the cut are ok', () => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT)
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0]).toEqual({
      place: 'engine',
      state: 'ok',
      detail: { key: 'engineOk', params: { format: 'WAV' } },
    })
  })

  // The whole path: the repoint the flush runs, then the check, on one real row.
  it('the repoint that carries the cut leaves a row the check reads as ok', async () => {
    const dir = trimmable()
    const to = join(dir, '..', 'Title.wav')
    writeFileSync(to, Buffer.alloc(SIZE_SMALL))
    write(dir, 'UPDATE Track SET path = ? WHERE id = 1', relative(dir, FROM_LOCAL(dir)))
    writeFileSync(FROM_LOCAL(dir), Buffer.alloc(1))
    const from = FROM_LOCAL(dir)
    const before = snapshot(dir, from)
    const shift = { trimmedMs: CUT * 1000, sampleRateHz: 48000 }
    const [result] = await repointEngineTracks(dir, [{ from, to, engineShift: shift }])
    expect(result.written).toBe(true)
    expect(
      checkOne(dir, expectFor(before, { from, to, size: SIZE_SMALL, samplesKept: false, shift })),
    ).toEqual([
      { place: 'engine', state: 'ok', detail: { key: 'engineOk', params: { format: 'WAV' } } },
    ])
  })

  it('positions rewritten at the new sample rate are ok', () => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT, 48000)
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT, 48000)))[0].state).toBe('ok')
  })

  // The bug this check exists for: the row followed the file and kept every blob intact,
  // so nothing looked lost, but each pad fired the length of the cut late.
  it('cues left where they were before the cut are engineCuesMisplaced', () => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0]).toEqual({
      place: 'engine',
      state: 'mismatch',
      detail: { key: 'engineCuesMisplaced', params: { field: 'quickCues' } },
    })
  })

  // The write keeps a loop's length when its start falls inside the cut, so the check reads
  // that loop on the new start with its length, not collapsed to nothing.
  it('a loop that started inside the cut, on the new start with its length, is ok', () => {
    const dir = library()
    write(dir, 'UPDATE PerformanceData SET loops = ?', loopsAt(0.5 * R, 1.5 * R))
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT)
    write(dir, 'UPDATE PerformanceData SET loops = ?', loopsAt(0, R))
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].state).toBe('ok')
  })

  it('a loop that started inside the cut, collapsed to nothing, is engineCuesMisplaced', () => {
    const dir = library()
    write(dir, 'UPDATE PerformanceData SET loops = ?', loopsAt(0.5 * R, 1.5 * R))
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT)
    write(dir, 'UPDATE PerformanceData SET loops = ?', loopsAt(0, 0))
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].detail).toEqual({
      key: 'engineCuesMisplaced',
      params: { field: 'loops' },
    })
  })

  // The write moves a row with no trackData by its grid's rate, so the check reads it by
  // the same rate rather than saying nothing about its cues.
  it('cues left behind on a row with no trackData are engineCuesMisplaced', () => {
    const dir = trimmable()
    write(dir, 'UPDATE PerformanceData SET trackData = NULL')
    const before = snapshot(dir)
    repoint(dir, 1)
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].detail).toEqual({
      key: 'engineCuesMisplaced',
      params: { field: 'quickCues' },
    })
  })

  // Engine falls back to the default grid when the DJ resets theirs, so a default grid left
  // where it was is a reset away from a grid the length of the cut late.
  it('a default grid left where it was is engineCuesMisplaced', () => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT)
    const read = new Database(engineDbPath(dir), { readonly: true })
    const row = read.prepare('SELECT beatData FROM PerformanceData').get() as {
      beatData: Uint8Array
    }
    read.close()
    const grid = inflateEngineBlob(row.beatData)
    const original = inflateEngineBlob(analysedTrack(1, CUES).beatData as Buffer)
    original.copy(grid, 17, 17, 17 + 8 + 2 * 24)
    write(dir, 'UPDATE PerformanceData SET beatData = ?', deflateEngineBlob(grid))
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].detail).toEqual({
      key: 'engineCuesMisplaced',
      params: { field: 'beatData' },
    })
  })

  it('cues moved by the cut twice are engineCuesMisplaced', () => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT * 2)
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].detail).toEqual({
      key: 'engineCuesMisplaced',
      params: { field: 'quickCues' },
    })
  })

  it.each([
    ['beatData', 'beatData = ?', () => analysedTrack(1, CUES).beatData],
    ['loops', 'loops = ?', () => loopsAt(8 * R, 10 * R)],
  ] as const)('a %s left where it was is engineCuesMisplaced', (field, set, blob) => {
    const dir = trimmable()
    const before = snapshot(dir)
    repoint(dir, 1)
    moved(dir, CUT)
    write(dir, `UPDATE PerformanceData SET ${set}`, blob())
    expect(checkOne(dir, expectFor(before, trimmedBy(CUT)))[0].detail).toEqual({
      key: 'engineCuesMisplaced',
      params: { field },
    })
  })
})
