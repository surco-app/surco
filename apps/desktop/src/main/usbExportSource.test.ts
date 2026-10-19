import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { SourceNode } from '../shared/types'
import { openRekordboxDb } from './rekordboxDb'
import { type ExportFixture, writeRekordboxExportFixture } from './rekordboxExportFixture'
import { readExportSelection, selectedPlaylists } from './usbExportSource'

// The spike's playlist (BASES › Makina) in miniature: a track with hot and memory cues, the
// blank separator, a second track, and House holding the second track again and a
// streaming row. Shapes from Vicent's collection (16/10).
const FIXTURE: ExportFixture = {
  content: [
    {
      ID: '101',
      FolderPath: '/Volumes/Public/Makina/Hands Of Fate.wav',
      FileType: 11,
      Title: 'Hands Of Fate (Original Mix)',
      Length: 380,
      BPM: 15400,
      Rating: 5,
      KeyID: 'k1',
    },
    {
      ID: '102',
      FolderPath: '/Volumes/Public/Makina/No Fear.aiff',
      FileType: 12,
      Title: 'No Fear',
      Length: 330,
      BPM: 15000,
    },
    { ID: '105', FolderPath: 'spotify:track:abc', FileType: 25, Title: 'Streamed', Length: 200 },
    {
      ID: '109',
      FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3',
      FileType: 1,
      Title: ' ',
      Length: 1,
    },
  ],
  keys: [{ ID: 'k1', ScaleName: '1A' }],
  playlists: [
    { ID: '1000', Name: 'BASES', Attribute: 1, ParentID: 'root', Seq: 1 },
    { ID: '2000', Name: 'Makina', Attribute: 0, ParentID: '1000', Seq: 1 },
    { ID: '3000', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 2 },
  ],
  links: [
    { PlaylistID: '2000', ContentID: '101', TrackNo: 1 },
    { PlaylistID: '2000', ContentID: '109', TrackNo: 2 },
    { PlaylistID: '2000', ContentID: '102', TrackNo: 3 },
    { PlaylistID: '3000', ContentID: '102', TrackNo: 1 },
    { PlaylistID: '3000', ContentID: '105', TrackNo: 2 },
    { PlaylistID: '3000', ContentID: '101', TrackNo: 3, deleted: true },
  ],
  details: {
    '101': {
      ArtistID: 'a1',
      AlbumID: 'al1',
      GenreID: 'g1',
      LabelID: 'l1',
      RemixerID: 'a2',
      Subtitle: 'Original Mix',
      BitRate: 2116,
      SampleRate: 44100,
      BitDepth: 24,
      ReleaseYear: 1997,
      TrackNo: 3,
      DiscNo: 1,
      DateCreated: '2024-05-01',
      DJPlayCount: 12,
      Commnt: 'Cue at the break',
      AnalysisDataPath: '/PIONEER/USBANLZ/51d/3f604-6497/ANLZ0000.DAT',
      ImagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg',
    },
    '102': { ArtistID: 'a3', BitDepth: 32, SampleRate: 96000 },
  },
  names: {
    artists: [
      { ID: 'a1', Name: 'Pastis & Buenri' },
      { ID: 'a2', Name: 'Remixer' },
      { ID: 'a3', Name: 'K-Style' },
    ],
    albums: [{ ID: 'al1', Name: 'Hands Of Fate' }],
    genres: [{ ID: 'g1', Name: 'Makina' }],
    labels: [{ ID: 'l1', Name: 'Bit Music' }],
  },
  cues: [
    { ContentID: '101', InMsec: 50000, OutMsec: -1, Kind: 2 },
    { ContentID: '101', InMsec: 1000, OutMsec: -1, Kind: 0, Comment: 'Intro' },
    { ContentID: '101', InMsec: 9000, OutMsec: 17000, Kind: 5 },
    { ContentID: '101', InMsec: 3000, OutMsec: -1, Kind: 1, deleted: true },
  ],
}

let dbPath = ''
beforeAll(async () => {
  dbPath = join(await mkdtemp(join(tmpdir(), 'usb-source-')), 'master.db')
  writeRekordboxExportFixture(dbPath, FIXTURE)
})

function read(ids: string[]) {
  const db = openRekordboxDb(dbPath, { readonly: true })
  if (!db) throw new Error('fixture did not open')
  try {
    return readExportSelection(db, ids)
  } finally {
    db.close()
  }
}

describe('selectedPlaylists', () => {
  const tree: SourceNode[] = [
    {
      id: 'f',
      name: 'BASES',
      kind: 'folder',
      count: 2,
      children: [
        { id: 'p1', name: 'Makina', kind: 'playlist', count: 2 },
        {
          id: 'f2',
          name: '90s',
          kind: 'folder',
          count: 1,
          children: [{ id: 'p2', name: 'Todas', kind: 'playlist', count: 9 }],
        },
      ],
    },
    { id: 'p3', name: 'House', kind: 'playlist', count: 1 },
  ]

  // Ticking a folder means everything under it, nested folders included, in rekordbox's order.
  it('expands a ticked folder to every playlist beneath it', () => {
    expect(
      selectedPlaylists(tree, new Set(['f'])).map((p) => [p.node.id, p.folders, p.folderIds]),
    ).toEqual([
      ['p1', ['BASES'], ['f']],
      ['p2', ['BASES', '90s'], ['f', 'f2']],
    ])
  })

  // A folder and one of its playlists both ticked must not list the playlist twice.
  it('lists a playlist once when it and its folder are both ticked', () => {
    expect(selectedPlaylists(tree, new Set(['f', 'p1', 'p3'])).map((p) => p.node.id)).toEqual([
      'p1',
      'p2',
      'p3',
    ])
  })
})

describe('readExportSelection', () => {
  it('reads the ticked playlists in tree order with their folders', () => {
    const sel = read(['3000', '1000'])
    expect(sel.playlists.map((p) => [p.name, p.folders, p.trackIds])).toEqual([
      ['Makina', ['BASES'], ['101', '109', '102']],
      ['House', [], ['102', '105']],
    ])
  })

  // The stick's sync file names folders by their master id, and stamps each playlist; two
  // folders with one name are still two folders there.
  it('gives each playlist its folder ids and updated_at', () => {
    const sel = read(['3000', '1000'])
    expect(sel.playlists.map((p) => [p.name, p.folderIds, p.updatedAt])).toEqual([
      ['Makina', ['1000'], Date.UTC(2026, 0, 1)],
      ['House', [], Date.UTC(2026, 0, 1)],
    ])
  })

  // A track in two playlists is one track on the stick: the collection lists it once and
  // both playlists point at it. The soft-deleted link is not a membership.
  it('keeps each track once, in the order it first appears', () => {
    expect(read(['1000', '3000']).tracks.map((t) => t.id)).toEqual(['101', '109', '102', '105'])
  })

  it('reads what the XML carries, names joined', () => {
    const t = read(['2000']).tracks[0]
    expect(t).toMatchObject({
      title: 'Hands Of Fate (Original Mix)',
      artist: 'Pastis & Buenri',
      album: 'Hands Of Fate',
      genre: 'Makina',
      label: 'Bit Music',
      remixer: 'Remixer',
      mix: 'Original Mix',
      key: '1A',
      fileType: 11,
      lengthSec: 380,
      bpm: 154,
      bitRate: 2116,
      sampleRate: 44100,
      bitDepth: 24,
      rating: 5,
      year: 1997,
      trackNo: 3,
      discNo: 1,
      dateAdded: '2024-05-01',
      playCount: 12,
      comment: 'Cue at the break',
      analysisPath: '/PIONEER/USBANLZ/51d/3f604-6497/ANLZ0000.DAT',
      imagePath: '/PIONEER/Artwork/00a/b1/artwork.jpg',
      separator: false,
      streaming: false,
    })
  })

  // Cues in time order, the deleted one gone; Kind is passed through untouched, the letter
  // mapping (with the unused 4) belongs to the XML.
  it('reads live cues in time order', () => {
    expect(read(['2000']).tracks[0].cues).toEqual([
      { inMs: 1000, outMs: -1, kind: 0, comment: 'Intro' },
      { inMs: 9000, outMs: 17000, kind: 5, comment: '' },
      { inMs: 50000, outMs: -1, kind: 2, comment: '' },
    ])
  })

  it('marks the separator and the streaming row', () => {
    const byId = new Map(read(['1000', '3000']).tracks.map((t) => [t.id, t]))
    expect(byId.get('109')?.separator).toBe(true)
    expect(byId.get('105')?.streaming).toBe(true)
  })

  it('reads nothing for nothing ticked', () => {
    expect(read([])).toEqual({ playlists: [], tracks: [] })
  })
})
