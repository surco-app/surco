import { describe, expect, it } from 'vitest'
import { buildBakenXml, hotCueNum } from './bakenXml'
import type { ExportSelection, ExportTrack } from './usbExportSource'

function track(over: Partial<ExportTrack>): ExportTrack {
  return {
    id: '1',
    path: '/Volumes/Public/Makina/a.wav',
    title: 'A',
    artist: '',
    album: '',
    genre: '',
    label: '',
    remixer: '',
    composer: '',
    mix: '',
    key: '',
    fileType: 11,
    lengthSec: 300,
    bpm: 150,
    bitRate: 1411,
    sampleRate: 44100,
    bitDepth: 16,
    rating: 0,
    year: 0,
    trackNo: 0,
    discNo: 0,
    dateAdded: '',
    playCount: 0,
    comment: '',
    analysisPath: '',
    imagePath: '',
    separator: false,
    streaming: false,
    cues: [],
    ...over,
  }
}

describe('hotCueNum', () => {
  // rekordbox's Kind skips 4: A=1, B=2, C=3, D=5, E=6, F=7, G=8, H=9 (measured 16/10). The
  // spike's first XML did Kind-1 and put D on E and E on F.
  it('maps rekordbox kinds to letters with 4 unused', () => {
    expect([0, 1, 2, 3, 5, 6, 7, 8, 9].map(hotCueNum)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('has no letter for a kind rekordbox does not use', () => {
    expect(hotCueNum(4)).toBeNull()
    expect(hotCueNum(10)).toBeNull()
  })
})

describe('buildBakenXml', () => {
  const a = track({
    id: '101',
    title: 'Hands Of Fate',
    artist: 'Pastis & Buenri',
    label: 'Bit Music',
    key: '1A',
    rating: 5,
    trackNo: 3,
    dateAdded: '2024-05-01',
    playCount: 12,
    path: '/Volumes/Public/Makina/Hands Of Fate #1.wav',
    cues: [
      { inMs: 1000, outMs: -1, kind: 0, comment: 'Intro' },
      { inMs: 9000, outMs: 17000, kind: 5, comment: '' },
    ],
  })
  const b = track({
    id: '102',
    title: 'No Fear',
    fileType: 12,
    path: '/Volumes/Public/Makina/No Fear.aiff',
  })
  const gone = track({ id: '103', title: 'Gone' })
  const sel: ExportSelection = {
    playlists: [
      {
        id: '2000',
        name: 'Makina',
        folders: ['BASES'],
        folderIds: ['1000'],
        updatedAt: 0,
        trackIds: ['101', '103', '102'],
      },
      { id: '3000', name: 'House', folders: [], folderIds: [], updatedAt: 0, trackIds: ['102'] },
    ],
    tracks: [a, gone, b],
  }
  const facts = new Map([
    [
      '101',
      {
        size: 76_000_123,
        grid: [
          { beat: 1, bpm: 154, ms: 50 },
          { beat: 2, bpm: 154, ms: 440 },
          { beat: 3, bpm: 150, ms: 830 },
        ],
      },
    ],
    ['102', { size: 50_000_000, grid: [] }],
  ])
  const xml = buildBakenXml(sel, facts)

  it('lists only the tracks with a file, once each', () => {
    expect(xml).toContain('<COLLECTION Entries="2">')
    expect(xml).not.toContain('Gone')
  })

  // master.db's FileSize goes stale when Surco rewrites tags (5 of 7 in the spike); baken
  // writes the size it is given into both databases.
  it('carries the real size and the data the stick shows', () => {
    expect(xml).toContain('Size="76000123"')
    expect(xml).toContain('Artist="Pastis &amp; Buenri"')
    expect(xml).toContain('Label="Bit Music"')
    expect(xml).toContain('Tonality="1A"')
    expect(xml).toContain('TrackNumber="3"')
    expect(xml).toContain('DateAdded="2024-05-01"')
    expect(xml).toContain('PlayCount="12"')
    expect(xml).toContain('AverageBpm="150.00"')
    // rekordbox XML rates 0..255 in steps of 51; 5 alone read as 0 stars in baken
    expect(xml).toContain('Rating="255"')
    expect(xml).toContain('Kind="WAV File"')
  })

  // A # or a space left raw cuts the Location at baken's URL decoding. The form is
  // rekordbox's own, file://localhost and the path, which baken's tests decode on both
  // platforms (file://localhost/C:/Music/... on Windows).
  it('writes a file URL baken can decode', () => {
    expect(xml).toContain(
      'Location="file://localhost/Volumes/Public/Makina/Hands%20Of%20Fate%20%231.wav"',
    )
  })

  it('writes a Windows path as rekordbox does on Windows', () => {
    const win = buildBakenXml(
      {
        playlists: [
          { id: 'p', name: 'P', folders: [], folderIds: [], updatedAt: 0, trackIds: ['9'] },
        ],
        tracks: [track({ id: '9', path: 'E:\\Musica\\No Fear.aiff' })],
      },
      new Map([['9', { size: 1, grid: [] }]]),
      'win32',
    )
    expect(win).toContain('Location="file://localhost/E:/Musica/No%20Fear.aiff"')
  })

  // One TEMPO per change of tempo, starting at the first beat, or the grid drifts after a
  // tempo change (Hands Of Fate changes at 50 s).
  it('writes one tempo line per tempo change', () => {
    expect(xml).toContain('<TEMPO Inizio="0.050" Bpm="154.00" Metro="4/4" Battito="1"/>')
    expect(xml).toContain('<TEMPO Inizio="0.830" Bpm="150.00" Metro="4/4" Battito="3"/>')
    expect(xml.match(/<TEMPO /g)).toHaveLength(2)
  })

  // No colour on hot cues: patched baken writes rekordbox's default for the letter.
  it('writes memory cues, loops and hot cue letters without colour', () => {
    expect(xml).toContain('<POSITION_MARK Name="Intro" Type="0" Start="1.000" Num="-1"/>')
    expect(xml).toContain('<POSITION_MARK Name="" Type="4" Start="9.000" End="17.000" Num="3"/>')
    expect(xml).not.toContain('Red=')
  })

  it('nests the playlists in their folders, in order, without the missing track', () => {
    const playlists = xml.slice(xml.indexOf('<PLAYLISTS>'))
    expect(playlists).toContain('<NODE Type="0" Name="ROOT" Count="2">')
    expect(playlists).toContain('<NODE Type="0" Name="BASES" Count="1">')
    expect(playlists).toContain(
      '<NODE Name="Makina" Type="1" KeyType="0" Entries="2"><TRACK Key="101"/><TRACK Key="102"/></NODE>',
    )
    expect(playlists.indexOf('BASES')).toBeLessThan(playlists.indexOf('House'))
    expect(xml).not.toContain('DeviceId')
  })

  // baken numbers the stick's playlists 1..N unless told; the stick's own numbers are what
  // rekordbox's playlists3.sync points at, so every node carries the one it already has.
  it('puts the stick id on each node', () => {
    const withIds = buildBakenXml(
      sel,
      facts,
      'darwin',
      new Map([
        ['1000', 1],
        ['2000', 2],
        ['3000', 3],
      ]),
    )
    expect(withIds).toContain('<NODE Type="0" Name="BASES" Count="1" DeviceId="1">')
    expect(withIds).toContain('<NODE Name="Makina" Type="1" KeyType="0" Entries="2" DeviceId="2">')
    expect(withIds).toContain('<NODE Name="House" Type="1" KeyType="0" Entries="1" DeviceId="3">')
    expect(withIds).toContain('<NODE Type="0" Name="ROOT" Count="2">')
  })

  // Two folders may share a name; merging them by name would hand one folder's playlists to
  // the other and leave one id unused.
  it('keeps two folders with one name apart', () => {
    const twins = buildBakenXml(
      {
        playlists: [
          { id: 'a', name: 'A', folders: ['X'], folderIds: ['f1'], updatedAt: 0, trackIds: ['9'] },
          { id: 'b', name: 'B', folders: ['X'], folderIds: ['f2'], updatedAt: 0, trackIds: ['9'] },
        ],
        tracks: [track({ id: '9' })],
      },
      new Map([['9', { size: 1, grid: [] }]]),
      'darwin',
      new Map([
        ['f1', 1],
        ['a', 2],
        ['f2', 3],
        ['b', 4],
      ]),
    )
    expect(twins).toContain('<NODE Type="0" Name="ROOT" Count="2">')
    expect(twins).toContain('<NODE Type="0" Name="X" Count="1" DeviceId="1">')
    expect(twins).toContain('<NODE Type="0" Name="X" Count="1" DeviceId="3">')
  })

  // Kinds 10-12 exist in master.db but have no letter; exporting them would put a cue on a
  // slot rekordbox does not show.
  it('leaves out cues of a kind without a letter', () => {
    const odd = buildBakenXml(
      {
        playlists: [],
        tracks: [
          track({
            id: '7',
            cues: [
              { inMs: 500, outMs: -1, kind: 10, comment: 'X' },
              { inMs: 600, outMs: -1, kind: 4, comment: 'Y' },
            ],
          }),
        ],
      },
      new Map([['7', { size: 1, grid: [] }]]),
    )
    expect(odd).not.toContain('POSITION_MARK')
  })

  // Task 5 reads cues ordered by InMsec only; equal times must not shuffle between runs.
  it('orders cues at the same time by kind', () => {
    const tied = buildBakenXml(
      {
        playlists: [],
        tracks: [
          track({
            id: '8',
            cues: [
              { inMs: 500, outMs: -1, kind: 2, comment: 'B' },
              { inMs: 500, outMs: -1, kind: 1, comment: 'A' },
            ],
          }),
        ],
      },
      new Map([['8', { size: 1, grid: [] }]]),
    )
    expect(tied.indexOf('Name="A"')).toBeLessThan(tied.indexOf('Name="B"'))
  })
})
