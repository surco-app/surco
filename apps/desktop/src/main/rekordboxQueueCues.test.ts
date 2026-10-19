import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
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
) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbqcues-'))
  const path = join(dir, 'master.db')
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content: ORGANISE_FIXTURE.content.map((c) =>
      c.ID === '103' ? { ...c, AnalysisDataPath: ANLZ } : c,
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

const op = (path: string, over: Partial<CuesOp> = {}): CuesOp => ({
  id: 'c',
  kind: 'cues',
  contentId: '103',
  path: '/Volumes/Public/Music/Gowan.wav',
  label: 'Gowan',
  drops: [bar(64)],
  previousDrops: [],
  fingerprint: fingerprintOf(path),
  ...over,
})

describe('cues operations', () => {
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

  it('writes nothing and says so when the plan needs more than 8 hot cues', async () => {
    const path = await collection([{ ID: 'y', InMsec: 500, Kind: 1, ColorTableIndex: 32 }])
    const drops = [bar(48), bar(96), bar(144), bar(192)]
    const result = await applyRekordboxBatch(path, [op(path, { drops })], deps())
    expect(result.ok && result.outcomes[0].notices).toEqual([
      { code: 'cues-too-many', track: 'Gowan' },
    ])
    expect(cuesOf(path)).toHaveLength(1)
  })

  it('writes only the drop on a track with hand-placed hot cues, never over manual work', async () => {
    const path = await collection([{ ID: 'm', InMsec: bar(40), Kind: 1, ColorTableIndex: 1 }])
    await applyRekordboxBatch(path, [op(path)], deps())
    expect(cuesOf(path).map((c) => [c.ms, c.kind])).toEqual([
      [bar(40), 1],
      [bar(64), 0],
    ])
  })

  it('applies a marking that is already in rekordbox without asking to close it', async () => {
    const path = await collection()
    await applyRekordboxBatch(path, [op(path)], deps())
    const d = deps()
    const result = await applyRekordboxBatch(path, [op(path, { previousDrops: [bar(64)] })], d)
    expect(result).toEqual({
      ok: true,
      wrote: false,
      outcomes: [{ id: 'c', applied: true, notices: [] }],
    })
    expect(d.ensureClosed).not.toHaveBeenCalled()
  })
})
