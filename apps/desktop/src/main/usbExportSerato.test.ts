import { describe, expect, it, vi } from 'vitest'
import { buildBakenXml } from './bakenXml'
import { rekordboxShiftOfFile } from './rekordboxTimeline'
import { seratoLeadOfFile } from './seratoClock'
import type { SeratoLibrary, SeratoLibraryTrack } from './seratoLibrary'
import { readSeratoTrack } from './seratoTags'
import { readSeratoExportSelection, type SeratoMarks, seratoExportMarks } from './usbExportSerato'

vi.mock('./seratoTags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./seratoTags')>()),
  readSeratoTrack: vi.fn(),
}))
vi.mock('./seratoClock', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./seratoClock')>()),
  seratoLeadOfFile: vi.fn(),
}))
vi.mock('./rekordboxTimeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./rekordboxTimeline')>()),
  rekordboxShiftOfFile: vi.fn(),
}))

const A = '/Users/dj/Música/a.mp3'.normalize('NFC')
const B = '/Users/dj/Canción.wav'.normalize('NFC')
const C = '/Users/dj/c.wav'
const GONE = '/Users/dj/gone.mp3'

const known = (file: string, over: Partial<SeratoLibraryTrack>): SeratoLibraryTrack => ({
  path: file.slice(1),
  file,
  title: '',
  artist: '',
  album: '',
  genre: '',
  bpm: '',
  key: '',
  addedAt: null,
  ...over,
})

const LIB: SeratoLibrary = {
  tracks: [
    known(A, {
      title: 'Alpha',
      artist: 'Ana',
      album: 'Uno',
      genre: 'House',
      bpm: '124.00',
      key: 'Am',
      addedAt: 1793688116,
    }),
    known(B, { title: 'Beta' }),
  ],
  crates: new Map([
    ['Sets', [A, B]],
    ['Sets%%Warm', [B.normalize('NFD'), C]],
    ['Empty', []],
    ['Empty%%Kid', [A]],
    ['Lost', [GONE]],
    ['Gig%%Fri', [A]],
  ]),
  links: new Map(),
  unreadable: [],
}

const marks = async (file: string): Promise<SeratoMarks | null> =>
  file === GONE
    ? null
    : {
        cues: [
          { inMs: 1000, outMs: -1, kind: 1, comment: 'Drop' },
          { inMs: 2000, outMs: 6000, kind: 0, comment: '' },
        ],
        grid: [],
        lengthSec: 300,
        sampleRate: 96000,
      }

describe('readSeratoExportSelection', () => {
  it('turns a crate with subcrates and tracks of its own into a folder holding its own list first, then its subcrates', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
    expect(sel.playlists.map((p) => [p.name, p.folders, p.folderIds])).toEqual([
      ['Sets', ['Sets'], ['Sets']],
      ['Warm', ['Sets'], ['Sets']],
    ])
  })

  it('leaves out the own list of a ticked parent crate with no tracks, keeping its subcrates in its folder', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Empty', 'Empty%%Kid'], { marks })
    expect(sel.playlists.map((p) => [p.name, p.folders])).toEqual([['Kid', ['Empty']]])
  })

  it('puts a subcrate ticked alone inside its parent folder, without the parent tracks', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets%%Warm'], { marks })
    expect(sel.playlists.map((p) => [p.name, p.folders])).toEqual([['Warm', ['Sets']]])
    expect(sel.tracks.map((t) => t.path.normalize('NFC'))).toEqual([B, C])
  })

  it('gives a track two crates share one id and one entry, whatever the normalization of its path', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
    expect(sel.tracks.filter((t) => t.path.normalize('NFC') === B)).toHaveLength(1)
    expect(sel.playlists[0].trackIds[1]).toBe(sel.playlists[1].trackIds[0])
    expect(sel.tracks.find((t) => t.path.normalize('NFC') === B)?.title).toBe('Beta')
  })

  it('finds the database V2 facts of a track a crate lists in NFD', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets%%Warm'], { marks })
    expect(sel.tracks[0]).toMatchObject({ path: B, title: 'Beta' })
  })

  it('exports only the own list of a parent crate ticked without its subcrates', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets'], { marks })
    expect(sel.playlists.map((p) => [p.name, p.folders])).toEqual([['Sets', ['Sets']]])
  })

  it('exports every crate inside a ticked folder that has no crate of its own', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Gig'], { marks })
    expect(sel.playlists.map((p) => [p.name, p.folders, p.folderIds])).toEqual([
      ['Fri', ['Gig'], ['Gig']],
    ])
  })

  it('takes the database V2 facts and the length, rate and cues of the file', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets'], { marks })
    expect(sel.tracks[0]).toMatchObject({
      title: 'Alpha',
      artist: 'Ana',
      album: 'Uno',
      genre: 'House',
      key: 'Am',
      bpm: 124,
      dateAdded: '2026-11-03',
      fileType: 1,
      lengthSec: 300,
      sampleRate: 96000,
      rating: 0,
      cues: [
        { inMs: 1000, outMs: -1, kind: 1, comment: 'Drop' },
        { inMs: 2000, outMs: 6000, kind: 0, comment: '' },
      ],
    })
  })

  it('names a crate track that database V2 does not know after its file', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets%%Warm'], { marks })
    expect(sel.tracks[1].title).toBe('c')
  })

  it('keeps a track that is not on disk, with no cues and not counted as going without them, so the plan lists it as missing', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Lost'], { marks })
    expect(sel.tracks).toHaveLength(1)
    expect(sel.tracks[0]).toMatchObject({ path: GONE, cues: [] })
    expect(sel.tracks[0].cuesLeftOut).toBeFalsy()
  })

  it('writes the nested folder, a hot cue and a memory loop into baken XML', async () => {
    const sel = await readSeratoExportSelection(LIB, ['Sets', 'Sets%%Warm'], { marks })
    const xml = buildBakenXml(
      sel,
      new Map(sel.tracks.map((t) => [t.id, { size: 1, grid: t.grid ?? [] }])),
      'darwin',
    )
    expect(xml).toMatch(
      /<NODE Type="0" Name="Sets" Count="2">\n<NODE Name="Sets" Type="1" KeyType="0" Entries="2">/,
    )
    expect(xml).toContain('<POSITION_MARK Name="Drop" Type="0" Start="1.000" Num="0"/>')
    expect(xml).toContain('<POSITION_MARK Name="" Type="4" Start="2.000" End="6.000" Num="-1"/>')
  })
})

describe('seratoExportMarks', () => {
  it('moves Serato cues, loops and grid onto rekordbox clock through Surco clock', async () => {
    vi.mocked(readSeratoTrack).mockReturnValue({
      payload: null,
      oldBlockDisagrees: false,
      durationMs: 10000,
      sampleRate: 44100,
      markers: {
        cues: [{ index: 0, ms: 1000, color: 0xcc0000, name: 'Drop' }],
        loops: [{ index: 0, startMs: 2000, endMs: 6000, name: '' }],
      },
      tempoMap: { firstBeatMs: 500, bpm: 120 },
    })
    vi.mocked(seratoLeadOfFile).mockResolvedValue(51.18)
    vi.mocked(rekordboxShiftOfFile).mockResolvedValue(26.12)
    const m = await seratoExportMarks('/m/a.mp3')
    expect(m?.cues[0]).toMatchObject({ kind: 1, comment: 'Drop', outMs: -1 })
    expect(m?.cues[0].inMs).toBeCloseTo(974.94, 6)
    expect(m?.cues[1].outMs).toBeCloseTo(5974.94, 6)
    expect(m?.grid[0]).toMatchObject({ beat: 1, bpm: 120 })
    expect(m?.grid[0].ms).toBeCloseTo(474.94, 6)
    expect(m).toMatchObject({ lengthSec: 10, sampleRate: 44100 })
  })

  it('has nothing to give for a file whose tags cannot be read', async () => {
    vi.mocked(readSeratoTrack).mockReturnValue(null)
    expect(await seratoExportMarks('/m/gone.mp3')).toBeNull()
  })
})
