import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  anlzFile,
  pqtzSection,
  pssiSection,
  pwavSection,
  pwv5Section,
  section,
} from './anlzFixture'
import { cueFingerprint, readTrackCues } from './rekordboxCues'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

const ANLZ = '/PIONEER/USBANLZ/219/e40e4/ANLZ0000.DAT'
const BEATS = Array.from({ length: 64 }, (_, i) => i * 500)

async function collection(over: { analysed?: boolean; ext?: Buffer | null; dat?: Buffer } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'surco-rbcues-'))
  const path = join(dir, 'master.db')
  const content = ORGANISE_FIXTURE.content.map((c) =>
    c.ID === '103' ? { ...c, AnalysisDataPath: over.analysed === false ? '' : ANLZ } : c,
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

  it('reads a truncated PWV5 as not analysed instead of throwing', async () => {
    const { db, share } = await collection({
      ext: anlzFile(
        pssiSection(1, [{ beat: 1, kind: 1 }]),
        section('PWV5', Buffer.alloc(0), Buffer.alloc(0)),
      ),
    })
    expect(readTrackCues(db, share, '103')?.analysed).toBe(false)
    db.close()
  })

  it('reads a truncated DAT as not analysed instead of throwing', async () => {
    const full = anlzFile(pqtzSection(BEATS), pwavSection([31, 0, 16]))
    const { db, share } = await collection({ dat: full.subarray(0, 40) })
    expect(readTrackCues(db, share, '103')).toMatchObject({ analysed: false, grid: [] })
    db.close()
  })

  it('hands cues Task 2 can consume as they are', async () => {
    const { db, share } = await collection()
    const q2 = readTrackCues(db, share, '103')?.cues.find((c) => c.id === 'q2')
    expect(q2).toEqual({ id: 'q2', ms: 8000, kind: 1, color: 1 })
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
