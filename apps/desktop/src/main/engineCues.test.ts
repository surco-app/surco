import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildEngineDatabase, loadSqlJs } from './engine'
import { readEngineTrackCues } from './engineCues'
import { analysedTrack, type EnginePerformanceRow } from './enginePerformanceFixture'
import { openEngineDb } from './enginePlaylists'
import { type EngineFixture, writeEngineLibraryFixture } from './enginePlaylistsFixture'

const TRACKS: EngineFixture['tracks'] = [
  { id: 1, path: '../Music/One.mp3', title: 'One', length: 60 },
  { id: 2, path: '../Music/Two.mp3', title: 'Two', length: 200 },
]

async function library(performance: EnginePerformanceRow[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginecues-'))
  writeEngineLibraryFixture(dir, {
    tracks: TRACKS,
    playlists: [],
    entities: [],
    performance,
  }).close()
  return dir
}

async function legacyLibrary(performance: EnginePerformanceRow): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginecues-218-'))
  const SQL = await loadSqlJs()
  const db = new SQL.Database(
    await buildEngineDatabase(
      [
        {
          relativePath: '../Music/One.mp3',
          filename: 'One.mp3',
          fileType: 'mp3',
          fileBytes: 100,
          title: 'One',
          artist: 'A',
          album: '',
          genre: '',
          comment: '',
          bpm: 120,
          bpmAnalyzed: 120,
          year: null,
          durationSec: 60,
          rating: 0,
        },
      ],
      'Crate',
    ),
  )
  db.run(
    'UPDATE Track SET trackData = ?, beatData = ?, quickCues = ?, overviewWaveFormData = ? WHERE id = 1',
    [
      performance.trackData ?? null,
      performance.beatData ?? null,
      performance.quickCues ?? null,
      performance.overviewWaveFormData ?? null,
    ],
  )
  mkdirSync(join(dir, 'Database2'), { recursive: true })
  writeFileSync(join(dir, 'Database2', 'm.db'), db.export())
  db.close()
  return dir
}

function read(dir: string, contentId: string, options?: { wave?: boolean }) {
  const db = openEngineDb(dir)
  if (!db) throw new Error('fixture did not open')
  try {
    return readEngineTrackCues(db, contentId, options)
  } finally {
    db.close()
  }
}

const SLOTS = [
  { label: 'Cue 1', sample: 44100 * 8, argb: 0xff28e214 },
  null,
  null,
  { label: 'Drop', sample: 44100 * 32, argb: 0xfff4d338 },
]

describe('readEngineTrackCues', () => {
  it('reads each filled pad as the hot cue of the same letter, in ms, with its colour on Surco’s table', async () => {
    const dir = await library([analysedTrack(1, SLOTS)])
    const cues = read(dir, 'engine:1')
    expect(cues?.cues).toEqual([
      { id: '0', ms: 8000, kind: 1, color: 22 },
      { id: '3', ms: 32000, kind: 5, color: 33 },
    ])
    expect(cues?.contentId).toBe('engine:1')
    expect(cues?.analysed).toBe(true)
    expect(cues?.durationMs).toBe(60000)
    expect(cues?.strong).toEqual([])
    expect(cues?.phrases).toEqual([])
  })

  it('lays the beats between Engine’s grid markers and counts beat 0 as a downbeat, so bars line up with Engine’s', async () => {
    const dir = await library([analysedTrack(1)])
    const grid = read(dir, 'engine:1')?.grid ?? []
    expect(grid).toHaveLength(120)
    expect(grid.slice(0, 5)).toEqual([
      { ms: 0, beat: 1 },
      { ms: 500, beat: 2 },
      { ms: 1000, beat: 3 },
      { ms: 1500, beat: 4 },
      { ms: 2000, beat: 1 },
    ])
    expect(grid.at(-1)).toEqual({ ms: 59500, beat: 4 })
  })

  it('draws the overview at its loudest band, scaled to the track’s peak', async () => {
    const dir = await library([analysedTrack(1)])
    expect(read(dir, 'engine:1')?.wave).toEqual([
      { h: 0.5, rgb: null },
      { h: 1, rgb: null },
    ])
    expect(read(dir, 'engine:1', { wave: false })?.wave).toBeNull()
  })

  it('says a track Engine has not analysed is not analysed, so the editor never places cues without a grid', async () => {
    const dir = await library([])
    expect(read(dir, 'engine:2')).toEqual({
      contentId: 'engine:2',
      analysed: false,
      grid: [],
      strong: [],
      phrases: [],
      cues: [],
      wave: null,
      durationMs: 200000,
      fingerprint: '',
    })
  })

  it('changes its fingerprint when the pads change, so a save queued on the old pads is refused', async () => {
    const before = read(await library([analysedTrack(1, SLOTS)]), 'engine:1')?.fingerprint
    const after = read(
      await library([analysedTrack(1, SLOTS.slice(0, 1))]),
      'engine:1',
    )?.fingerprint
    expect(before).not.toBe(after)
  })

  it('finds nothing for a track that is not in the library or an id that is not Engine’s', async () => {
    const dir = await library([analysedTrack(1)])
    expect(read(dir, 'engine:9')).toBeNull()
    expect(read(dir, '103')).toBeNull()
  })

  it('reads a 2.18 library, where the blobs are columns of Track, the same way', async () => {
    const dir = await legacyLibrary(analysedTrack(1, SLOTS))
    expect(read(dir, 'engine:1')?.cues).toEqual([
      { id: '0', ms: 8000, kind: 1, color: 22 },
      { id: '3', ms: 32000, kind: 5, color: 33 },
    ])
  })
})
