import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3-multiple-ciphers'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WantedCue } from '../shared/cueRules'
import { hotCueArgb } from '../shared/rekordboxCueColors'
import { buildEngineDatabase, loadSqlJs } from './engine'
import { decodeQuickCues, inflateEngineBlob } from './engineBlobs'
import { readEngineTrackCues } from './engineCues'
import { applyEngineCuesBatch } from './engineCuesWrite'
import { analysedTrack, MAIN_CUE_TAIL, quickCuesRaw } from './enginePerformanceFixture'
import { openEngineDb } from './enginePlaylists'
import { writeEngineLibraryFixture } from './enginePlaylistsFixture'
import { isEngineDjRunning } from './engineProcess'
import type { CuesOp } from './rekordboxQueueOps'

vi.mock('./engineProcess', () => ({ isEngineDjRunning: vi.fn(async () => false) }))
beforeEach(() => vi.mocked(isEngineDjRunning).mockResolvedValue(false))

const SLOTS = [
  { label: 'Cue 1', sample: 44100 * 8, argb: 0xfff4d338 },
  null,
  null,
  { label: 'Drop', sample: 44100 * 32, argb: 0xfff4d338 },
]

async function library(schema: '3.0.2' | '2.18' = '3.0.2'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginecuesw-'))
  const perf = analysedTrack(1, SLOTS)
  if (schema === '3.0.2') {
    writeEngineLibraryFixture(dir, {
      tracks: [{ id: 1, path: '../Music/a.mp3', title: 'a', length: 60 }],
      playlists: [],
      entities: [],
      performance: [perf],
    }).close()
    return dir
  }
  const SQL = await loadSqlJs()
  const db = new SQL.Database(
    await buildEngineDatabase(
      [
        {
          relativePath: '../Music/a.mp3',
          filename: 'a.mp3',
          fileType: 'mp3',
          fileBytes: 100,
          title: 'a',
          artist: '',
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
  db.run('UPDATE Track SET trackData = ?, beatData = ?, quickCues = ? WHERE id = 1', [
    perf.trackData ?? null,
    perf.beatData ?? null,
    perf.quickCues ?? null,
  ])
  mkdirSync(join(dir, 'Database2'), { recursive: true })
  writeFileSync(join(dir, 'Database2', 'm.db'), db.export())
  db.close()
  return dir
}

const dbFile = (dir: string) => join(dir, 'Database2', 'm.db')

function current(dir: string) {
  const db = openEngineDb(dir)
  if (!db) throw new Error('library did not open')
  try {
    const read = readEngineTrackCues(db, 'engine:1', { wave: false })
    if (!read) throw new Error('track missing')
    return read
  } finally {
    db.close()
  }
}

function slotsOf(dir: string) {
  const db = new Database(dbFile(dir), { readonly: true })
  try {
    const row = db.prepare('SELECT quickCues FROM PerformanceData WHERE trackId = 1').get() as {
      quickCues: Buffer
    }
    const decoded = decodeQuickCues(inflateEngineBlob(row.quickCues))
    if (!decoded) throw new Error('quick cues unreadable')
    return decoded
  } finally {
    db.close()
  }
}

function op(dir: string, wanted: WantedCue[], over: Partial<CuesOp> = {}): CuesOp {
  return {
    id: 'op1',
    kind: 'cues',
    contentId: 'engine:1',
    path: '/m/a.mp3',
    label: 'a',
    wanted,
    fingerprint: current(dir).fingerprint,
    ...over,
  }
}

const deps = (over: Partial<Parameters<typeof applyEngineCuesBatch>[2]> = {}) => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  ...over,
})

const UNTOUCHED = { id: '0', ms: 8000, kind: 1, color: 33 }

describe.each(['3.0.2', '2.18'] as const)('applyEngineCuesBatch on a %s library', (schema) => {
  it('writes moved and new hot cues to their pads and leaves an untouched pad, its label and the main cue exactly as Engine stored them', async () => {
    const dir = await library(schema)
    const before = slotsOf(dir)
    const result = await applyEngineCuesBatch(
      dir,
      [
        op(dir, [
          UNTOUCHED,
          { id: '3', ms: 16000, kind: 5, color: 33 },
          { ms: 24000, kind: 2, color: 42 },
        ]),
      ],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: true,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    const after = slotsOf(dir)
    expect(after.slots[0].bytes).toEqual(before.slots[0].bytes)
    expect(after.slots.map((s) => s.cue)).toEqual([
      SLOTS[0],
      { label: '', sample: 44100 * 24, argb: hotCueArgb(42) },
      null,
      { label: 'Drop', sample: 44100 * 16, argb: 0xfff4d338 },
      null,
      null,
      null,
      null,
    ])
    expect(after.tail).toEqual(MAIN_CUE_TAIL)
  })

  it('paints a pad the DJ recoloured in the new colour, keeping its name and place', async () => {
    const dir = await library(schema)
    await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { id: '3', ms: 32000, kind: 5, color: 42 }])],
      deps(),
    )
    expect(slotsOf(dir).slots[3].cue).toEqual({
      label: 'Drop',
      sample: 44100 * 32,
      argb: hotCueArgb(42),
    })
  })

  it('empties the pad of a hot cue the DJ removed', async () => {
    const dir = await library(schema)
    await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], deps())
    expect(slotsOf(dir).slots.map((s) => s.cue)).toEqual([
      SLOTS[0],
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    ])
  })
})

describe('applyEngineCuesBatch', () => {
  it('writes no CALL, since Engine has none, and names the ones left out so the DJ is told', async () => {
    const dir = await library()
    const result = await applyEngineCuesBatch(
      dir,
      [
        op(dir, [
          UNTOUCHED,
          { id: '3', ms: 32000, kind: 5, color: 33 },
          { ms: 4000, kind: 0, color: null },
          { ms: 12000, kind: 0, color: null },
        ]),
      ],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [
        {
          id: 'op1',
          applied: true,
          notices: [{ code: 'cues-calls-dropped', track: 'a', calls: [4000, 12000] }],
        },
      ],
    })
    expect(slotsOf(dir).slots.map((s) => s.cue)).toEqual(quickCuesRawSlots())
  })

  it('backs up the library before writing, both the run’s copy and the fixed one next to m.db', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const d = deps()
    await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], d)
    expect(d.sessionBackup).toHaveBeenCalledWith(dbFile(dir))
    expect(readFileSync(`${dbFile(dir)}.surco-backup`)).toEqual(original)
  })

  it('refuses a save made on pads that changed in Engine since, so the DJ’s newer cues are never overwritten', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED], { fingerprint: 'stale' })],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: false, notices: [{ code: 'cues-changed', track: 'a' }] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
    expect(existsSync(`${dbFile(dir)}.surco-backup`)).toBe(false)
  })

  it('refuses a set that names a pad Engine does not have, rather than writing part of it', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { ms: 9000, kind: 10, color: 22 }])],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: false, notices: [{ code: 'cues-invalid', track: 'a' }] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })

  it('leaves the library alone and keeps waiting while Engine DJ is open, since Engine would write its own copy back over it', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    vi.mocked(isEngineDjRunning).mockResolvedValue(true)
    const result = await applyEngineCuesBatch(dir, [op(dir, [UNTOUCHED])], deps())
    expect(result).toEqual({ ok: false, reason: 'rekordbox-running' })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })

  it('does nothing when the DJ declines to close Engine', async () => {
    const dir = await library()
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED])],
      deps({ ensureClosed: vi.fn(async () => false) }),
    )
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
  })

  it('writes nothing when the pads already hold what was asked', async () => {
    const dir = await library()
    const original = readFileSync(dbFile(dir))
    const result = await applyEngineCuesBatch(
      dir,
      [op(dir, [UNTOUCHED, { id: '3', ms: 32000, kind: 5, color: 33 }])],
      deps(),
    )
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'op1', applied: true, notices: [] }],
    })
    expect(readFileSync(dbFile(dir))).toEqual(original)
  })
})

function quickCuesRawSlots() {
  return decodeQuickCues(quickCuesRaw(SLOTS))?.slots.map((s) => s.cue)
}
