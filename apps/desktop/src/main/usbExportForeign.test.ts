import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { buildBakenXml } from './bakenXml'
import { shiftCues } from './rekordboxCues'
import { openRekordboxDb } from './rekordboxDb'
import { ORGANISE_FIXTURE, writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'
import {
  exportFileType,
  exportTrackIds,
  fileMemo,
  foreignExportTrack,
  marksOnRekordboxClock,
} from './usbExportForeign'

describe('marksOnRekordboxClock', () => {
  it('moves every cue, loop end and beat by the same delta', () => {
    const m = marksOnRekordboxClock(
      [
        { ms: 1000, kind: 1, name: 'Drop' },
        { ms: 2000, kind: 0, name: '', endMs: 6000 },
      ],
      [
        { ms: 500, beat: 1 },
        { ms: 1000, beat: 2 },
      ],
      26.12,
    )
    expect(m.cues).toEqual([
      { inMs: 1026.12, outMs: -1, kind: 1, comment: 'Drop' },
      { inMs: 2026.12, outMs: 6026.12, kind: 0, comment: '' },
    ])
    expect(m.grid.map((b) => b.ms)).toEqual([526.12, 1026.12])
  })

  it('drops beats that would land before zero and pins a cue there at zero', () => {
    const m = marksOnRekordboxClock(
      [{ ms: 0.5, kind: 1, name: '' }],
      [
        { ms: 0.5, beat: 1 },
        { ms: 500.5, beat: 2 },
        { ms: 1000.5, beat: 3 },
      ],
      -0.9,
    )
    expect(m.cues[0].inMs).toBe(0)
    expect(m.grid.map((b) => b.beat)).toEqual([2, 3])
  })

  it('gives a whole grid one tempo, so baken writes a single TEMPO', () => {
    const beats = Array.from({ length: 400 }, (_, k) => ({
      ms: 123.4 + (k * 60000) / 123.455,
      beat: (k % 4) + 1,
    }))
    const { grid } = marksOnRekordboxClock([], beats, 0)
    const t = foreignExportTrack('1', '/m/a.wav', { grid })
    const xml = buildBakenXml(
      { playlists: [], tracks: [t] },
      new Map([['1', { size: 1, grid }]]),
      'darwin',
    )
    expect(xml.match(/<TEMPO /g)).toHaveLength(1)
  })

  it('leaves a grid of one beat out, since one beat has no tempo', () => {
    expect(marksOnRekordboxClock([], [{ ms: 500, beat: 1 }], 0).grid).toEqual([])
  })

  it('places cues where rekordbox own cue shift puts the same cues, so a CDJ finds them on the same beat', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-foreign-')), 'master.db')
    writeRekordboxPlaylistFixture(path, {
      ...ORGANISE_FIXTURE,
      cueRows: [
        { ID: 'a', ContentID: '103', InMsec: 8000, Kind: 1, ColorTableIndex: 1 },
        { ID: 'b', ContentID: '103', InMsec: 16000, Kind: 2, ColorTableIndex: 1, OutMsec: 18000 },
        { ID: 'c', ContentID: '103', InMsec: 30000, Kind: 0, ColorTableIndex: null },
        { ID: 'd', ContentID: '103', InMsec: 2000, Kind: 3, ColorTableIndex: 1, OutMsec: 4000 },
      ],
    })
    const db = openRekordboxDb(path)
    if (!db) throw new Error('did not open')
    const delta = -9000
    shiftCues(db, '103', delta, { now: new Date('2026-11-04T10:00:00.000Z') })
    const written = db
      .prepare(`SELECT InMsec, OutMsec, Kind FROM djmdCue WHERE ContentID = '103' ORDER BY ID`)
      .all() as { InMsec: number; OutMsec: number; Kind: number }[]
    db.close()
    const { cues } = marksOnRekordboxClock(
      [
        { ms: 8000, kind: 1, name: '' },
        { ms: 16000, kind: 2, name: '', endMs: 18000 },
        { ms: 30000, kind: 0, name: '' },
        { ms: 2000, kind: 3, name: '', endMs: 4000 },
      ],
      [],
      delta,
    )
    expect(cues.map((c) => ({ InMsec: c.inMs, OutMsec: c.outMs, Kind: c.kind }))).toEqual(written)
  })
})

describe('exportTrackIds', () => {
  it('gives one path written in NFD or NFC the same id', () => {
    const nfc = '/Users/dj/Música/a.mp3'
    const ids = exportTrackIds([nfc.normalize('NFD'), nfc.normalize('NFC')])
    expect([...ids.values()]).toHaveLength(1)
  })

  it('keeps a track id when the selection around it changes, so the next export knows what left', () => {
    expect(exportTrackIds(['/m/a.mp3']).get('/m/a.mp3')).toBe(
      exportTrackIds(['/m/z.wav', '/m/a.mp3']).get('/m/a.mp3'),
    )
  })

  it('moves the second of two paths that hash alike to the next free id, by order of appearance', () => {
    const [x, y] = ['/m/75879.mp3', '/m/452256.mp3']
    expect([...exportTrackIds([x, y]).entries()]).toEqual([
      [x, '53301735'],
      [y, '53301736'],
    ])
    expect(exportTrackIds([y, x]).get(x)).toBe('53301736')
  })

  it('never gives two tracks one id, and every id is a number baken takes', () => {
    const paths = Array.from({ length: 5000 }, (_, i) => `/m/${i}.mp3`)
    const ids = [...exportTrackIds(paths).values()]
    expect(new Set(ids).size).toBe(5000)
    expect(
      ids.every((id) => /^\d+$/.test(id) && Number(id) >= 1 && Number(id) <= 2_000_000_000),
    ).toBe(true)
  })
})

describe('exportFileType', () => {
  it.each([
    ['a.MP3', 1],
    ['a.m4a', 4],
    ['a.mp4', 4],
    ['a.flac', 5],
    ['a.wav', 11],
    ['a.aif', 12],
    ['a.aiff', 12],
    ['a.ogg', 0],
  ])('types %s as %i', (path, type) => {
    expect(exportFileType(path)).toBe(type)
  })
})

describe('fileMemo', () => {
  const facts = new Map([
    ['/m/a.mp3', { size: 10, mtimeMs: 1 }],
    ['/m/b.mp3', { size: 20, mtimeMs: 2 }],
  ])
  const factsOf = async (file: string) => facts.get(file) ?? null

  it('reads an unchanged file once across plans, so a repeated summary never opens its tags again', async () => {
    const read = vi.fn(async (file: string) => `${file}#${read.mock.calls.length}`)
    const memo = fileMemo(read, factsOf, 10)
    expect(await memo()('/m/a.mp3')).toBe('/m/a.mp3#1')
    expect(await memo()('/m/a.mp3')).toBe('/m/a.mp3#1')
    expect(read).toHaveBeenCalledOnce()
  })

  it('reads a file again once its size or modification time changed, since its cues may have moved', async () => {
    const read = vi.fn(async (file: string) => `${file}#${read.mock.calls.length}`)
    const memo = fileMemo(read, factsOf, 10)
    await memo()('/m/a.mp3')
    facts.set('/m/a.mp3', { size: 10, mtimeMs: 5 })
    expect(await memo()('/m/a.mp3')).toBe('/m/a.mp3#2')
    facts.set('/m/a.mp3', { size: 11, mtimeMs: 5 })
    expect(await memo()('/m/a.mp3')).toBe('/m/a.mp3#3')
    facts.set('/m/a.mp3', { size: 10, mtimeMs: 1 })
  })

  it('reads a file that cannot be stated every time, as nothing tells a later read it is the same', async () => {
    const read = vi.fn(async () => 'x')
    const memo = fileMemo(read, factsOf, 10)
    await memo()('/m/gone.mp3')
    await memo()('/m/gone.mp3')
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('keeps only what the last plan read, and no more than its limit, so the memory follows the selection', async () => {
    const read = vi.fn(async (file: string) => file)
    const memo = fileMemo(read, factsOf, 1)
    const first = memo()
    await first('/m/a.mp3')
    await first('/m/b.mp3')
    const second = memo()
    await second('/m/b.mp3')
    await memo()('/m/a.mp3')
    expect(read.mock.calls.map(([f]) => f)).toEqual([
      '/m/a.mp3',
      '/m/b.mp3',
      '/m/b.mp3',
      '/m/a.mp3',
    ])
  })
})
