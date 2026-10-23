import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HOT_KINDS, type WantedCue } from '../shared/cueRules'
import { anlzFile, pqtzSection } from './anlzFixture'
import { openRekordboxDb } from './rekordboxDb'
import {
  ORGANISE_FIXTURE,
  TWIN_PATHS,
  writeRekordboxPlaylistFixture,
} from './rekordboxPlaylistsFixture'
import type { CuesOp } from './rekordboxQueueOps'

vi.mock('./rekordboxProcess', () => ({ isRekordboxRunning: vi.fn(async () => false) }))

import { cueFingerprint, liveCues } from './rekordboxCues'
import { applyRekordboxBatch } from './rekordboxPlaylistWrite'

const ANLZ = '/PIONEER/USBANLZ/1/a/ANLZ0000.DAT'
const BEATS = Array.from({ length: 800 }, (_, i) => i * 500)
const bar = (n: number) => BEATS[n * 4]

async function collection(
  cues: { ID: string; InMsec: number; Kind: number; ColorTableIndex: number | null }[] = [],
  analysed = true,
) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbqcues-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '103' && analysed ? { ...c, AnalysisDataPath: ANLZ } : c,
    ),
    cueRows: cues.map((q) => ({ ...q, ContentID: '103' })),
  })
  mkdirSync(join(dir, 'share/PIONEER/USBANLZ/1/a'), { recursive: true })
  writeFileSync(join(dir, 'share', ANLZ), anlzFile(pqtzSection(BEATS)))
  return path
}

function fingerprintOf(path: string): string {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return cueFingerprint(liveCues(db, '103'))
  } finally {
    db.close()
  }
}

function cuesOf(path: string) {
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  try {
    return liveCues(db, '103').sort((a, b) => a.ms - b.ms || a.kind - b.kind)
  } finally {
    db.close()
  }
}

function moveCue(path: string, id: string, ms: number): void {
  const db = openRekordboxDb(path)
  if (!db) throw new Error('did not open')
  try {
    db.prepare('UPDATE djmdCue SET InMsec = ? WHERE ID = ?').run(ms, id)
  } finally {
    db.close()
  }
}

const deps = () => ({
  ensureClosed: vi.fn(async () => true),
  sessionBackup: vi.fn(async () => {}),
  now: () => new Date('2026-10-18T19:00:00.000Z'),
  ...TWIN_PATHS,
})

const COUNTDOWN: WantedCue[] = [
  { ms: bar(64), kind: 0, color: null },
  { ms: bar(16), kind: 1, color: 42 },
  { ms: bar(16), kind: 0, color: null },
  { ms: bar(32), kind: 2, color: 22 },
  { ms: bar(32), kind: 0, color: null },
  { ms: bar(48), kind: 3, color: 1 },
  { ms: bar(48), kind: 0, color: null },
]

const op = (path: string, over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'c',
  kind: 'cues',
  contentId: '103',
  path: '/Volumes/Public/Music/Gowan.wav',
  label: 'Gowan',
  wanted: COUNTDOWN,
  fingerprint: fingerprintOf(path),
  ...over,
})

describe('cues operations', () => {
  it("reports what an adjustment onto rekordbox's grid did once it is written", async () => {
    const path = await collection()
    const notices = [{ code: 'cues-adjusted' as const, track: 'Gowan', moved: 2, maxMs: 7 }]
    const result = await applyRekordboxBatch(path, [op(path, { notices })], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'c', applied: true, notices })
  })

  it('still reports the cues it left alone when the adjustment changed nothing else', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(64), Kind: 0, ColorTableIndex: null }])
    const notices = [
      { code: 'cues-unfit' as const, track: 'Gowan', count: 1, contentId: '7', ms: 1000 },
    ]
    const wanted = [{ id: 'm', ms: bar(64), kind: 0, color: null }]
    const result = await applyRekordboxBatch(path, [op(path, { wanted, notices })], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'c', applied: true, notices })
  })

  it("writes the set the editor built on Surco's grid to a track rekordbox has not analysed yet, which keeps it through its first analysis", async () => {
    const path = await collection([], false)
    const result = await applyRekordboxBatch(path, [op(path)], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'c', applied: true, notices: [] })
    expect(cuesOf(path)).toHaveLength(COUNTDOWN.length)
  })

  it('still refuses a save holding only drops on a track rekordbox has not analysed, since turning drops into cues needs its grid', async () => {
    const path = await collection([], false)
    const result = await applyRekordboxBatch(
      path,
      [op(path, { wanted: undefined, drops: [bar(64)], previousDrops: [] })],
      deps(),
    )
    expect(result.ok && result.outcomes[0]).toEqual({
      id: 'c',
      applied: false,
      notices: [{ code: 'cues-changed', track: 'Gowan' }],
    })
    expect(cuesOf(path)).toEqual([])
  })

  it('writes the drop and its countdown in one batch, as the DJ marked it', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(path, [op(path)], deps())
    expect(result.ok && result.outcomes[0]).toEqual({ id: 'c', applied: true, notices: [] })
    expect(result.ok && result.wrote).toBe(true)
    expect(cuesOf(path).map((c) => [c.ms, c.kind, c.color])).toEqual([
      [bar(16), 0, null],
      [bar(16), 1, 42],
      [bar(32), 0, null],
      [bar(32), 2, 22],
      [bar(48), 0, null],
      [bar(48), 3, 1],
      [bar(64), 0, null],
    ])
  })

  it('drops the operation without asking to close rekordbox when rekordbox changed the cues since the section read them', async () => {
    const path = await collection()
    const d = deps()
    const result = await applyRekordboxBatch(path, [op(path, { fingerprint: 'stale' })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: false, notices: [{ code: 'cues-changed', track: 'Gowan' }] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('lets rekordbox win when a cue is moved there while the user answers the close dialog', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    const d = deps()
    const queued = op(path)
    d.ensureClosed.mockImplementation(async () => {
      moveCue(path, 'm', bar(44))
      return true
    })
    const result = await applyRekordboxBatch(path, [queued], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: false, notices: [{ code: 'cues-changed', track: 'Gowan' }] }],
    })
    expect(cuesOf(path).map((c) => [c.ms, c.kind])).toEqual([[bar(44), 1]])
  })

  it('writes nothing for cues the user discarded while rekordbox was being closed', async () => {
    const path = await collection()
    const result = await applyRekordboxBatch(path, [op(path)], {
      ...deps(),
      stillQueued: () => false,
    })
    expect(result.ok && result.outcomes[0]).toMatchObject({ applied: false, reason: 'cancelled' })
    expect(cuesOf(path)).toEqual([])
  })

  it('writes nothing and says so when the wanted set has more than 8 hot cues', async () => {
    const path = await collection([{ ID: 'k', InMsec: bar(72), Kind: 10, ColorTableIndex: 1 }])
    const wanted = Array.from({ length: 9 }, (_, i) =>
      i < HOT_KINDS.length
        ? { ms: bar(8 * i + 8), kind: HOT_KINDS[i], color: 1 }
        : { id: 'k', ms: bar(72), kind: 10, color: 1 },
    )
    const result = await applyRekordboxBatch(path, [op(path, { wanted })], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'cues-too-many', track: 'Gowan' },
    ])
    expect(cuesOf(path).map((c) => c.id)).toEqual(['k'])
  })

  it('refuses a malformed set as invalid instead of throwing, so the rest of the batch still lands', async () => {
    const path = await collection()
    const malformed = op(path, { id: 'bad', wanted: [null] as unknown as WantedCue[] })
    const good = op(path, { id: 'good', contentId: '103' })
    const result = await applyRekordboxBatch(path, [malformed, good], deps())
    expect(result.ok && result.outcomes).toEqual([
      { id: 'bad', applied: false, notices: [{ code: 'cues-invalid', track: 'Gowan' }] },
      { id: 'good', applied: true, notices: [] },
    ])
    expect(cuesOf(path)).toHaveLength(COUNTDOWN.length)
  })

  it('refuses an operation with neither a wanted set nor drops, which would only delete the drops', async () => {
    const path = await collection([{ ID: 'd', InMsec: bar(64), Kind: 0, ColorTableIndex: null }])
    const empty = op(path, { wanted: undefined })
    const result = await applyRekordboxBatch(path, [empty], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'cues-invalid', track: 'Gowan' },
    ])
    expect(cuesOf(path).map((c) => c.id)).toEqual(['d'])
  })

  it('moves a cue rekordbox already has instead of adding a second one', async () => {
    const path = await collection([
      { ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 },
      { ID: 'n', InMsec: bar(40), Kind: 0, ColorTableIndex: null },
    ])
    const wanted = [
      { id: 'm', ms: bar(44), kind: 1, color: 1 },
      { id: 'n', ms: bar(44), kind: 0, color: null },
    ]
    await applyRekordboxBatch(path, [op(path, { wanted })], deps())
    expect(cuesOf(path).map((c) => [c.id, c.ms, c.kind])).toEqual([
      ['n', bar(44), 0],
      ['m', bar(44), 1],
    ])
  })

  it('deletes the cues the wanted set leaves out', async () => {
    const path = await collection([
      { ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 },
      { ID: 'n', InMsec: bar(64), Kind: 0, ColorTableIndex: null },
    ])
    await applyRekordboxBatch(
      path,
      [op(path, { wanted: [{ id: 'n', ms: bar(64), kind: 0, color: null }] })],
      deps(),
    )
    expect(cuesOf(path).map((c) => c.id)).toEqual(['n'])
  })

  it('applies a wanted set that is already in rekordbox without asking to close it', async () => {
    const path = await collection()
    await applyRekordboxBatch(path, [op(path)], deps())
    const d = deps()
    const wanted = cuesOf(path).map(({ id, ms, kind, color }) => ({ id, ms, kind, color }))
    const result = await applyRekordboxBatch(path, [op(path, { wanted })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: true, notices: [] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })

  it('refuses a wanted set that would corrupt rekordbox and writes nothing', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    const d = deps()
    const wanted = [
      { id: 'm', ms: bar(40), kind: 1, color: 1 },
      { ms: bar(44), kind: 1, color: 1 },
    ]
    const result = await applyRekordboxBatch(path, [op(path, { wanted })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: false, notices: [{ code: 'cues-invalid', track: 'Gowan' }] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
    expect(cuesOf(path).map((c) => c.id)).toEqual(['m'])
  })

  it('says a queued drops operation from the previous build needs more than 8 hot cues and writes nothing', async () => {
    const path = await collection([{ ID: 'y', InMsec: 500, Kind: 1, ColorTableIndex: 32 }])
    const legacy = op(path, {
      wanted: undefined,
      drops: [bar(48), bar(96), bar(144), bar(192)],
      previousDrops: [],
    })
    const result = await applyRekordboxBatch(path, [legacy], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'cues-too-many', track: 'Gowan' },
    ])
    expect(cuesOf(path)).toHaveLength(1)
  })

  it('still lands an operation the previous build queued with drops, as Mi flujo and never over manual work', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    const legacy = op(path, { wanted: undefined, drops: [bar(64)], previousDrops: [] })
    await applyRekordboxBatch(path, [legacy], deps())
    expect(cuesOf(path).map((c) => [c.ms, c.kind])).toEqual([
      [bar(40), 1],
      [bar(64), 0],
    ])
  })
})
