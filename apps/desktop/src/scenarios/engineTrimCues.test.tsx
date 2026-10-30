// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())
vi.mock('../main/engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))

import { loadSqlJs } from '../main/engine'
import {
  decodeBeatGrid,
  decodeQuickCues,
  decodeTrackData,
  inflateEngineBlob,
} from '../main/engineBlobs'
import { analysedTrack } from '../main/enginePerformanceFixture'
import { engineDbPath, writeEngineLibraryFixture } from '../main/enginePlaylistsFixture'
import { makeTrack, scenarioDir } from './fixtures'
import { openSurco, type Scenario } from './harness'

const RATE = 44100
const TRIM_SEC = 1.9
const CUE_SEC = [1, 5, 12]

async function performance(library: string) {
  const SQL = await loadSqlJs()
  const db = new SQL.Database(readFileSync(engineDbPath(library)))
  try {
    const [row] = db.exec('SELECT trackData, beatData, quickCues FROM PerformanceData')[0].values
    const [trackData, beatData, quickCues] = row.map((b) => inflateEngineBlob(b as Uint8Array))
    const rate = decodeTrackData(trackData)?.sampleRate ?? 0
    const sec = (sample: number) => sample / rate
    const cues = decodeQuickCues(quickCues)
    return {
      cues: cues?.slots.map((s) => (s.cue ? sec(s.cue.sample) : null)) ?? [],
      mainCue: sec(cues?.tail.readDoubleBE(0) ?? 0),
      grid: decodeBeatGrid(beatData)?.markers.map((m) => sec(m.sample)) ?? [],
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
    writeEngineLibraryFixture(library, {
      tracks: [{ id: 1, path: relative(library, source) }],
      playlists: [],
      entities: [],
      performance: [
        analysedTrack(
          1,
          CUE_SEC.map((s, i) => ({ label: `C${i}`, sample: s * RATE, argb: 0xffcc0000 })),
        ),
      ],
    }).close()
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
})
