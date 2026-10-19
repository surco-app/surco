import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExistingCue } from '../shared/cueRules'
import {
  anlzFile,
  pqtzSection,
  pssiSection,
  pwavSection,
  pwv5Section,
  section,
} from './anlzFixture'
import { applyCueChanges, cueFingerprint, readTrackCues } from './rekordboxCues'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/219/e40e4/ANLZ0000.DAT'
const BEATS = Array.from({ length: 64 }, (_, i) => i * 500)

async function collection(
  over: { analysed?: boolean; ext?: Buffer | null; dat?: Buffer; path?: string } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbcues-'))
  const path = join(dir, 'master.db')
  const content = ORGANISE_FIXTURE.content.map((c) =>
    c.ID === '103'
      ? { ...c, AnalysisDataPath: over.analysed === false ? '' : (over.path ?? ANLZ) }
      : c,
  )
  writeRekordboxPlaylistFixture(path, {
    ...ORGANISE_FIXTURE,
    content,
    cueRows: [
      { ID: 'q2', ContentID: '103', InMsec: 8000, Kind: 1, ColorTableIndex: 1 },
      { ID: 'q1', ContentID: '103', InMsec: 8000, Kind: 0, ColorTableIndex: null },
      { ID: 'q3', ContentID: '103', InMsec: 16000, Kind: 0, ColorTableIndex: null },
    ],
  })
  const share = join(dir, 'share')
  mkdirSync(join(share, '/PIONEER/USBANLZ/219/e40e4'), { recursive: true })
  writeFileSync(
    join(share, ANLZ),
    over.dat ?? anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16])),
  )
  if (over.ext !== null)
    writeFileSync(
      join(share, ANLZ.replace('.DAT', '.EXT')),
      over.ext ??
        anlzFile(
          pssiSection(1, [
            { beat: 1, kind: 1 },
            { beat: 33, kind: 5 },
          ]),
          pwv5Section([{ r: 7, g: 7, b: 7, h: 31 }]),
        ),
    )
  const db = openRekordboxDb(path, { readonly: true })
  if (!db) throw new Error('did not open')
  return { db, share }
}

describe('readTrackCues', () => {
  it('reads the grid, the strong parts, the cues and the colour waveform', async () => {
    const { db, share } = await collection()
    const read = readTrackCues(db, share, '103')
    expect(read).toMatchObject({
      contentId: '103',
      analysed: true,
      durationMs: 300000,
      strong: [{ start: BEATS[32], end: BEATS[63] }],
      wave: [{ h: 1, rgb: [255, 255, 255] }],
    })
    expect(read?.grid.slice(0, 5)).toEqual([
      { ms: 0, beat: 1 },
      { ms: 500, beat: 2 },
      { ms: 1000, beat: 3 },
      { ms: 1500, beat: 4 },
      { ms: 2000, beat: 1 },
    ])
    expect(read?.cues.map((c) => c.id).sort()).toEqual(['q1', 'q2', 'q3'])
    db.close()
  })
  it('falls back to the monochrome preview waveform without an .EXT', async () => {
    const { db, share } = await collection({ ext: null })
    expect(readTrackCues(db, share, '103')?.wave?.[0]).toEqual({ h: 1, rgb: null })
    db.close()
  })
  it('says a track rekordbox has not analysed yet, since a track plan A added has no grid or marking', async () => {
    const { db, share } = await collection({ analysed: false })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [], wave: null })
    db.close()
  })

  it('answers null for an entry that is gone', async () => {
    const { db, share } = await collection()
    expect(readTrackCues(db, share, '999')).toBeNull()
    db.close()
  })
  it('does not build the waveforms for a whole-collection read but keeps the strong parts', async () => {
    const { db, share } = await collection()
    const read = readTrackCues(db, share, '103', { wave: false })
    expect(read).toMatchObject({
      analysed: true,
      wave: null,
      strong: [{ start: BEATS[32], end: BEATS[63] }],
    })
    db.close()
  })

  it('reads a truncated PSSI as not analysed instead of throwing', async () => {
    const { db, share } = await collection({
      ext: anlzFile(section('PSSI', Buffer.alloc(0), Buffer.alloc(2))),
    })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [], wave: null })
    db.close()
  })

  it('keeps a good grid when the colour waveform is truncated', async () => {
    const { db, share } = await collection({
      ext: anlzFile(
        pssiSection(1, [{ beat: 1, kind: 1 }]),
        section('PWV5', Buffer.alloc(0), Buffer.alloc(0)),
      ),
    })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: true, wave: null })
    expect(readTrackCues(db, share, '103')?.grid).toHaveLength(64)
    db.close()
  })

  it('reads a track whose DAT is missing from disk as not analysed', async () => {
    const { db, share } = await collection()
    rmSync(join(share, ANLZ))
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [], wave: null })
    db.close()
  })

  it('never reads an analysis path that climbs out of the share folder', async () => {
    const { db, share } = await collection({ path: '/../outside/ANLZ0000.DAT' })
    mkdirSync(join(share, '..', 'outside'), { recursive: true })
    writeFileSync(
      join(share, '..', 'outside', 'ANLZ0000.DAT'),
      anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16])),
    )
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [], wave: null })
    db.close()
  })

  it('reads a truncated DAT as not analysed instead of throwing', async () => {
    const full = anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16]))
    const { db, share } = await collection({ dat: full.subarray(0, 40) })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [] })
    db.close()
  })

  it('returns cue rows typed as the existing cues the change planner takes, so no mapping can drift', async () => {
    const { db, share } = await collection()
    const existing: ExistingCue[] = readTrackCues(db, share, '103')?.cues ?? []
    expect(existing.find((c) => c.id === 'q2')).toEqual({ id: 'q2', ms: 8000, kind: 1, color: 1 })
    db.close()
  })
})

describe('cueFingerprint', () => {
  it('changes with any cue rekordbox added, moved, recoloured or deleted and ignores their order', () => {
    const a = { id: 'q1', ms: 8000, kind: 0, color: null }
    const b = { id: 'q2', ms: 8000, kind: 1, color: 1 }
    expect(cueFingerprint([a, b])).toBe(cueFingerprint([b, a]))
    expect(cueFingerprint([a, { ...b, color: 22 }])).not.toBe(cueFingerprint([a, b]))
    expect(cueFingerprint([a])).not.toBe(cueFingerprint([a, b]))
  })
})

describe('applyCueChanges', () => {
  const NOW = new Date('2026-10-18T19:00:00.000Z')
  const STAMP = '2026-10-18 19:00:00.000 +00:00'

  async function writable() {
    const dir = await mkdtemp(join(tmpdir(), 'surco-rbcuew-'))
    const path = join(dir, 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      cueRows: [
        { ID: 'q2', ContentID: '103', InMsec: 8000, Kind: 1, ColorTableIndex: 1 },
        { ID: 'q1', ContentID: '103', InMsec: 8000, Kind: 0, ColorTableIndex: null },
        { ID: 'q3', ContentID: '103', InMsec: 16000, Kind: 0, ColorTableIndex: null },
        { ID: 'other', ContentID: '104', InMsec: 1000, Kind: 0, ColorTableIndex: null },
      ],
    })
    const db = openRekordboxDb(path)
    if (!db) throw new Error('did not open')
    return db
  }

  const changes = {
    insert: [
      { ms: 4000, kind: 2, color: 22 },
      { ms: 4000, kind: 0, color: null },
    ],
    update: [{ id: 'q2', kind: 3, color: 1 }],
    remove: ['q3'],
  }

  it('writes the cue rows the way the spike did and rekordbox accepted', async () => {
    const db = await writable()
    const ids = ['70001', '70002', '70003']
    expect(
      applyCueChanges(db, '103', changes, { now: NOW, newCueId: () => ids.shift() as string }),
    ).toBe(4)
    const row = (id: string) =>
      db.prepare('SELECT * FROM djmdCue WHERE ID = ?').get(id) as Record<string, unknown>
    expect(row('70001')).toMatchObject({
      ContentID: '103',
      ContentUUID: 'uuid-c-103',
      InMsec: 4000,
      InFrame: 600,
      OutMsec: -1,
      OutFrame: 0,
      InMpegFrame: 0,
      Kind: 2,
      Color: -1,
      ColorTableIndex: 22,
      rb_local_usn: null,
      rb_local_deleted: 0,
      created_at: STAMP,
    })
    expect(row('70002')).toMatchObject({ Kind: 0, ColorTableIndex: null })
    expect(row('q2')).toMatchObject({ Kind: 3, ColorTableIndex: 1, updated_at: STAMP })
    expect(Number(row('q2').rb_local_usn)).toBeGreaterThan(500)
    expect(db.prepare(`SELECT ID FROM djmdCue WHERE ID = 'q3'`).get()).toBeUndefined()
    db.close()
  })

  it('keeps contentCue and the track counters in step', async () => {
    const db = await writable()
    const ids = ['70001', '70002', '70003']
    applyCueChanges(db, '103', changes, { now: NOW, newCueId: () => ids.shift() as string })
    const cc = db.prepare(`SELECT * FROM contentCue WHERE ContentID = '103'`).get() as {
      ID: string
      Cues: string
      rb_cue_count: number
      rb_local_usn: number
    }
    expect(cc.ID).toBe('uuid-c-103')
    const entries = JSON.parse(cc.Cues) as { ID: string; Kind: number; updated_at: string }[]
    expect(entries.map((e) => e.ID).sort()).toEqual(['70001', '70002'])
    expect(cc.rb_cue_count).toBe(2)
    const content = db
      .prepare(`SELECT CueUpdated, rb_local_usn, updated_at FROM djmdContent WHERE ID = '103'`)
      .get() as {
      CueUpdated: string
      rb_local_usn: number
      updated_at: string
    }
    expect(content.CueUpdated).toBe('4')
    expect(content.rb_local_usn).toBe(cc.rb_local_usn + 1)
    expect(content.updated_at).toBe(STAMP)
    db.close()
  })

  it('updates an existing contentCue entry and drops the removed one', async () => {
    const db = await writable()
    db.prepare(
      `INSERT INTO contentCue (ID, ContentID, Cues, rb_cue_count) VALUES ('uuid-c-103', '103', ?, 2)`,
    ).run(
      JSON.stringify([
        { ID: 'q2', Kind: 1, InMsec: 8000 },
        { ID: 'q3', Kind: 0, InMsec: 16000 },
      ]),
    )
    applyCueChanges(
      db,
      '103',
      { insert: [], update: [{ id: 'q2', kind: 3, color: 1 }], remove: ['q3'] },
      { now: NOW },
    )
    const cc = db
      .prepare(`SELECT Cues, rb_cue_count FROM contentCue WHERE ContentID = '103'`)
      .get() as {
      Cues: string
      rb_cue_count: number
    }
    expect(JSON.parse(cc.Cues)).toEqual([
      { ID: 'q2', Kind: 3, InMsec: 8000, updated_at: '2026-10-18T19:00:00.000+00:00' },
    ])
    expect(cc.rb_cue_count).toBe(1)
    db.close()
  })

  it('never touches another track nor writes anything for an empty change', async () => {
    const db = await writable()
    expect(applyCueChanges(db, '103', { insert: [], update: [], remove: [] }, { now: NOW })).toBe(0)
    expect(db.prepare(`SELECT CueUpdated FROM djmdContent WHERE ID = '103'`).get()).toEqual({
      CueUpdated: null,
    })
    applyCueChanges(db, '103', changes, { now: NOW })
    expect(db.prepare(`SELECT ID FROM djmdCue WHERE ContentID = '104'`).all()).toEqual([
      { ID: 'other' },
    ])
    db.close()
  })
})
