// @vitest-environment jsdom
import { readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { loadSqlJs } from '../main/engine'
import {
  decodeBeatGrid,
  decodeLoops,
  decodeQuickCues,
  decodeTrackData,
  encodeLoops,
  inflateEngineBlob,
} from '../main/engineBlobs'
import { analysedTrack } from '../main/enginePerformanceFixture'
import { engineDbPath, writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import { makeTrack, scenarioDir } from './fixtures'
import { invokeMain, openSurco, type Scenario } from './harness'

const RATE = 44100
const TRIM_SEC = 1.9
const CUE_SEC = [1, 5, 12]
const LOOP_SEC = [
  [0.5, 1.5],
  [8, 10],
]
const loopsBlob = () =>
  encodeLoops(
    LOOP_SEC.map(([start, end]) => ({
      label: '',
      start: start * RATE,
      end: end * RATE,
      startSet: true,
      endSet: true,
      argb: 0xff00cc00,
    })),
  )

async function performance(library: string) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(engineDbPath(library)))
  try {
    const [row] = db.exec('SELECT trackData, beatData, quickCues, loops FROM PerformanceData')[0]
      .values
    const [trackData, beatData, quickCues] = row
      .slice(0, 3)
      .map((b) => inflateEngineBlob(b as Uint8Array))
    const rate = decodeTrackData(trackData)?.sampleRate ?? 0
    const sec = (sample: number) => sample / rate
    const cues = decodeQuickCues(quickCues)
    return {
      cues: cues?.slots.map((s) => (s.cue ? sec(s.cue.sample) : null)) ?? [],
      mainCue: sec(cues?.tail.readDoubleBE(0) ?? 0),
      grid: decodeBeatGrid(beatData)?.markers.map((m) => sec(m.sample)) ?? [],
      loops:
        decodeLoops(Buffer.from((row[3] as Uint8Array | null) ?? []))?.loops.map((l) => [
          sec(l.start),
          sec(l.end),
        ]) ?? [],
    }
  } finally {
    db.close()
  }
}

// The DJ set hot cues in Engine on the record as it was, lead-in and all. Cutting the
// lead-in moves every beat earlier, so Engine's cues, main cue and grid have to move by the
// same amount, or each one fires late on a track that now starts on the music.
describe('Cut the silence before a record without moving its Engine DJ cues off the beat', () => {
  let surco: Scenario
  let library: string
  let before: Awaited<ReturnType<typeof performance>>
  let after: Awaited<ReturnType<typeof performance>>

  beforeAll(async () => {
    const root = scenarioDir('engine-trim')
    const source = join(root, 'Crate', 'Record.flac')
    library = join(root, 'Engine Library')
    makeTrack(source, {
      title: 'Record',
      artist: 'A',
      lavfi: `aevalsrc=0.3*sin(2*PI*220*t):s=${RATE}:d=20`,
    })
    const db = writeEngineLibraryFixture(library, {
      tracks: [{ id: 1, path: relative(library, source) }],
      playlists: [],
      entities: [],
      performance: [
        analysedTrack(
          1,
          CUE_SEC.map((s, i) => ({ label: `C${i}`, sample: s * RATE, argb: 0xffcc0000 })),
        ),
      ],
    })
    db.prepare('UPDATE PerformanceData SET loops = ? WHERE trackId = 1').run(loopsBlob())
    db.close()
    before = await performance(library)
    surco = await openSurco({
      settings: {
        outputDir: join(root, 'Surco'),
        outputFormat: 'aiff',
        engineLibraryDir: library,
        syncEngineDj: true,
      },
    })
    await surco.drop(join(root, 'Crate'))
    surco.patchTrack('Record.flac', { trim: { startSec: TRIM_SEC } })
    await surco.convertAll()
    after = await performance(library)
  }, 90_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('keeps the same Engine row, now on the converted file', async () => {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(readFileSync(engineDbPath(library)))
    try {
      expect(db.exec('SELECT id, path FROM Track')[0].values).toEqual([
        [1, relative(library, join(library, '..', 'Surco', 'Record.aiff'))],
      ])
    } finally {
      db.close()
    }
  })

  it('moves every hot cue earlier by the cut, and the one inside the cut to the new start', () => {
    expect(after.cues.slice(0, 3)).toEqual([
      0,
      expect.closeTo(CUE_SEC[1] - TRIM_SEC, 4),
      expect.closeTo(CUE_SEC[2] - TRIM_SEC, 4),
    ])
    expect(after.cues.slice(3)).toEqual(before.cues.slice(3))
  })

  it('moves the main cue with the audio', () => {
    expect(after.mainCue).toBeCloseTo(before.mainCue - TRIM_SEC, 4)
  })

  it('moves the beat grid by the cut, so every beat still falls on the music', () => {
    expect(after.grid).toEqual(before.grid.map((s) => expect.closeTo(s - TRIM_SEC, 4)))
  })

  it('moves every loop by the cut, and one set in the lead-in to the new start at its length', () => {
    expect(before.loops).toEqual(LOOP_SEC)
    expect(after.loops).toEqual([
      [0, expect.closeTo(1, 4)],
      [expect.closeTo(8 - TRIM_SEC, 4), expect.closeTo(10 - TRIM_SEC, 4)],
    ])
  })
})

// Re-saving the record as the same format, over itself, keeps its path, so Engine's row does
// not move: the cut still has to reach its cues, once.
describe('Cut the silence before a record rewritten over itself, with its Engine DJ cues', () => {
  let surco: Scenario
  let library: string
  let source: string
  let before: Awaited<ReturnType<typeof performance>>
  let after: Awaited<ReturnType<typeof performance>>

  beforeAll(async () => {
    const root = scenarioDir('engine-trim-in-place')
    source = join(root, 'Crate', 'Record.flac')
    library = join(root, 'Engine Library')
    makeTrack(source, {
      title: 'Record',
      artist: 'A',
      lavfi: `aevalsrc=0.3*sin(2*PI*220*t):s=${RATE}:d=20`,
    })
    const db = writeEngineLibraryFixture(library, {
      tracks: [{ id: 1, path: relative(library, source) }],
      playlists: [],
      entities: [],
      performance: [
        analysedTrack(
          1,
          CUE_SEC.map((s, i) => ({ label: `C${i}`, sample: s * RATE, argb: 0xffcc0000 })),
        ),
      ],
    })
    db.prepare("UPDATE Track SET fileType = 'flac', fileBytes = ?, length = 20 WHERE id = 1").run(
      statSync(source).size,
    )
    db.close()
    before = await performance(library)
    surco = await openSurco({
      settings: { outputFormat: 'source', engineLibraryDir: library, syncEngineDj: true },
      destination: 'overwrite',
    })
    await surco.drop(join(root, 'Crate'))
    surco.patchTrack('Record.flac', { trim: { startSec: TRIM_SEC } })
    await surco.convertAll()
    after = await performance(library)
  }, 90_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('moves every hot cue and the grid earlier by the cut', () => {
    expect(after.cues.slice(0, 3)).toEqual([
      0,
      expect.closeTo(CUE_SEC[1] - TRIM_SEC, 4),
      expect.closeTo(CUE_SEC[2] - TRIM_SEC, 4),
    ])
    expect(after.grid).toEqual(before.grid.map((s) => expect.closeTo(s - TRIM_SEC, 4)))
  })

  it('records the rewritten file’s size, the mark that the cut already came off', async () => {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(readFileSync(engineDbPath(library)))
    try {
      expect(db.exec('SELECT path, fileBytes FROM Track')[0].values).toEqual([
        [relative(library, source), statSync(source).size],
      ])
    } finally {
      db.close()
    }
  })

  it('shows the cut record’s duration in Engine’s track list', async () => {
    const SQL = await loadSqlJs()
    const db = new SQL.Database(readFileSync(engineDbPath(library)))
    try {
      expect(db.exec('SELECT length FROM Track')[0].values).toEqual([[Math.round(20 - TRIM_SEC)]])
    } finally {
      db.close()
    }
  })
})

// Putting the original back over the cut record, from the Originals panel or an Undo, gives
// Engine its lead-in again: the row has to go back with it, cues and grid on the beats they
// were set on and the length it had, or every pad fires early on the record now playing.
describe('Put back the original of a record cut over itself, with its Engine DJ cues', () => {
  let surco: Scenario
  let library: string
  let source: string
  let originalSize: number
  let before: Awaited<ReturnType<typeof performance>>
  let after: Awaited<ReturnType<typeof performance>>

  beforeAll(async () => {
    const root = scenarioDir('engine-trim-restore')
    source = join(root, 'Crate', 'Record.flac')
    library = join(root, 'Engine Library')
    makeTrack(source, {
      title: 'Record',
      artist: 'A',
      lavfi: `aevalsrc=0.3*sin(2*PI*220*t):s=${RATE}:d=20`,
    })
    originalSize = statSync(source).size
    const db = writeEngineLibraryFixture(library, {
      tracks: [{ id: 1, path: relative(library, source) }],
      playlists: [],
      entities: [],
      performance: [
        analysedTrack(
          1,
          CUE_SEC.map((s, i) => ({ label: `C${i}`, sample: s * RATE, argb: 0xffcc0000 })),
        ),
      ],
    })
    db.prepare("UPDATE Track SET fileType = 'flac', fileBytes = ?, length = 20 WHERE id = 1").run(
      originalSize,
    )
    db.close()
    before = await performance(library)
    surco = await openSurco({
      settings: { outputFormat: 'source', engineLibraryDir: library, syncEngineDj: true },
      destination: 'overwrite',
    })
    await surco.drop(join(root, 'Crate'))
    surco.patchTrack('Record.flac', { trim: { startSec: TRIM_SEC } })
    await surco.convertAll()
    const [kept] = (await surco.trash.list()).filter((e) => e.originalPath === source)
    await invokeMain('trash:restore', kept.id)
    await surco.engineClosed()
    after = await performance(library)
  }, 90_000)

  it('runs without a single error the user would see', () => {
    expect(surco.errors).toEqual([])
  })

  it('records the original’s size and length on the same row', async () => {
    expect(statSync(source).size).toBe(originalSize)
    const SQL = await loadSqlJs()
    const db = new SQL.Database(readFileSync(engineDbPath(library)))
    try {
      expect(db.exec('SELECT id, fileBytes, length FROM Track')[0].values).toEqual([
        [1, originalSize, 20],
      ])
    } finally {
      db.close()
    }
  })

  it('puts the cues and the grid back where the DJ set them', () => {
    expect(after.cues.slice(1, 3)).toEqual([
      expect.closeTo(CUE_SEC[1], 3),
      expect.closeTo(CUE_SEC[2], 3),
    ])
    expect(after.mainCue).toBeCloseTo(before.mainCue, 3)
    expect(after.grid).toEqual(before.grid.map((s) => expect.closeTo(s, 3)))
  })

  // The cut took the lead-in a cue sat in, so the cut moved it to the new start: back on
  // the original it lands where the music starts, the nearest the row still knows.
  it('leaves a cue the cut had moved to the new start where the music starts', () => {
    expect(after.cues[0]).toBeCloseTo(TRIM_SEC, 3)
  })
})
