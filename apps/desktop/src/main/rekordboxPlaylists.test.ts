import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix, win32 } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mediaUrl } from '../shared/media'
import { openRekordboxDb } from './rekordboxDb'
import {
  coverFileOf,
  entryPath,
  readRekordboxPlaylist,
  readRekordboxPlaylistWithPreview,
  readRekordboxTree,
} from './rekordboxPlaylists'
import { writeRekordboxPlaylistFixture } from './rekordboxPlaylistsFixture'

// Shapes measured on a real 2067-track collection (15/10): folders nested two deep whose
// playlists repeat names ("Todas" under CANTADITAS › 90s and BASES › 90s), one blank
// separator MP3 linked hundreds of times, and a −128 cloud-sync trial playlist.
const SEP = {
  ID: 'sep',
  FolderPath: '/Users/dj/Music/PioneerDJ/Blank Audio/_.mp3',
  FileType: 1,
  Title: ' ',
  Length: 1,
  KeyID: 'k1',
}
const NIGHT = {
  ID: 'c1',
  FolderPath: '/Volumes/Public/Music/Rebel Vision/Night Train.aiff',
  FileType: 12,
  Title: 'Night Train (Extended Mix)',
  Length: 256,
  BPM: 15000,
  Rating: 0,
  KeyID: 'k1',
}
const PLAY = {
  ID: 'c2',
  FolderPath: '/Volumes/Public/Music/2 Fabiola/Play This Song.wav',
  FileType: 11,
  Title: 'Play This Song (Transformix)',
  Length: 338,
  BPM: 13807,
  Rating: 5,
  KeyID: 'k2',
}
const SPOTIFY = {
  ID: 'c3',
  FolderPath: 'spotify:track:0OTO8ZF2YqFQVw9hnZylTd',
  FileType: 25,
  Title: 'Streamed',
  Length: 200,
}
const GONE = {
  ID: 'c4',
  FolderPath: '/Volumes/Public/Music/gone.wav',
  FileType: 11,
  Title: 'Gone',
  Length: 300,
  deleted: true,
}

let db: NonNullable<ReturnType<typeof openRekordboxDb>>

beforeAll(async () => {
  const path = join(await mkdtemp(join(tmpdir(), 'surco-rbpl-')), 'master.db')
  writeRekordboxPlaylistFixture(path, {
    content: [SEP, NIGHT, PLAY, SPOTIFY, GONE],
    keys: [
      { ID: 'k1', ScaleName: '4B' },
      { ID: 'k2', ScaleName: '8A' },
    ],
    playlists: [
      { ID: 'combos', Name: 'COMBOS', Attribute: 1, ParentID: 'root', Seq: 2 },
      { ID: 'factory', Name: 'Factory', Attribute: 0, ParentID: 'combos', Seq: 2 },
      { ID: 'nineties', Name: '90s', Attribute: 0, ParentID: 'combos', Seq: 1 },
      { ID: 'cant', Name: 'CANTADITAS', Attribute: 1, ParentID: 'root', Seq: 1 },
      { ID: 'cant90', Name: '90s', Attribute: 1, ParentID: 'cant', Seq: 1 },
      { ID: 'cant90todas', Name: 'Todas', Attribute: 0, ParentID: 'cant90', Seq: 1 },
      { ID: 'house', Name: 'House', Attribute: 0, ParentID: 'root', Seq: 3 },
      {
        ID: 'trial',
        Name: 'Trial playlist - Cloud Library Sync',
        Attribute: -128,
        ParentID: 'root',
        Seq: 4,
      },
      { ID: 'old', Name: 'Borrada', Attribute: 0, ParentID: 'root', Seq: 5, deleted: true },
    ],
    links: [
      { PlaylistID: 'factory', ContentID: 'c1', TrackNo: 1 },
      { PlaylistID: 'factory', ContentID: 'sep', TrackNo: 2 },
      { PlaylistID: 'factory', ContentID: 'c2', TrackNo: 3 },
      { PlaylistID: 'factory', ContentID: 'c3', TrackNo: 4 },
      { PlaylistID: 'factory', ContentID: 'c4', TrackNo: 5 },
      { PlaylistID: 'factory', ContentID: 'c2', TrackNo: 6, deleted: true },
      { PlaylistID: 'cant90todas', ContentID: 'c2', TrackNo: 1 },
      { PlaylistID: 'nineties', ContentID: 'c1', TrackNo: 1, deleted: null },
      { PlaylistID: 'house', ContentID: 'c1', TrackNo: 1 },
      { PlaylistID: 'house', ContentID: 'c2', TrackNo: 2 },
      { PlaylistID: 'house', ContentID: 'c1', TrackNo: 3 },
    ],
  })
  const opened = openRekordboxDb(path, { readonly: true })
  if (!opened) throw new Error('fixture did not open')
  db = opened
})

afterAll(() => db.close())

describe('readRekordboxTree', () => {
  it('nests folders and orders siblings by Seq, as rekordbox shows them', () => {
    const tree = readRekordboxTree(db)
    expect(tree.map((n) => n.name)).toEqual(['CANTADITAS', 'COMBOS', 'House'])
    const combos = tree[1]
    expect(combos.kind).toBe('folder')
    expect(combos.children?.map((n) => n.name)).toEqual(['90s', 'Factory'])
    expect(tree[0].children?.[0].children?.[0]).toMatchObject({
      id: 'cant90todas',
      name: 'Todas',
      kind: 'playlist',
    })
  })

  it('counts only real tracks, so the number matches the rows the list will show', () => {
    // Factory links a track, a separator, another track, a streaming row, a deleted track
    // and a deleted link: the user sees the two tracks and the streaming row's absence.
    const factory = readRekordboxTree(db)[1].children?.[1]
    expect(factory?.count).toBe(3)
  })

  it('counts a track linked twice once, since the list shows each file in one row', () => {
    // Measured: Factory read 76 in the tree over 70 rows, COMBOS › 20Ks 565 over 325.
    const house = readRekordboxTree(db)[2]
    expect(house.count).toBe(2)
  })

  it('keeps a link whose deleted flag is NULL, since only 1 means deleted', () => {
    const nineties = readRekordboxTree(db)[1].children?.[0]
    expect(nineties?.count).toBe(1)
  })

  it('leaves out the cloud-sync trial row and deleted playlists, which rekordbox does not list', () => {
    const names = readRekordboxTree(db).map((n) => n.name)
    expect(names).not.toContain('Trial playlist - Cloud Library Sync')
    expect(names).not.toContain('Borrada')
  })
})

describe('readRekordboxPlaylist', () => {
  it('returns the rows in TrackNo order with the separator in place', () => {
    const rows = readRekordboxPlaylist(db, 'factory')
    expect(rows.map((r) => [r.path, r.separator])).toEqual([
      [NIGHT.FolderPath, false],
      [SEP.FolderPath, true],
      [PLAY.FolderPath, false],
      [null, false],
    ])
  })

  it('carries what rekordbox knows in the shared scale: bpm unscaled, key as spelled, rating ×20', () => {
    const [night, , play] = readRekordboxPlaylist(db, 'factory')
    expect(night.meta).toEqual({ bpm: '150', key: '4B' })
    expect(play.meta).toEqual({ bpm: '138.07', key: '8A', rating: 100 })
  })

  it('lists a link whose deleted flag is NULL, since only 1 means deleted', () => {
    expect(readRekordboxPlaylist(db, 'nineties').map((r) => r.path)).toEqual([NIGHT.FolderPath])
  })

  it('returns nothing for a playlist that is not there, rather than throwing', () => {
    expect(readRekordboxPlaylist(db, 'missing')).toEqual([])
  })

  // Editing a playlist addresses its rows, not its files: a file can sit in a playlist twice
  // and the separator file sits there dozens of times, so only the link row says which one
  // the user dragged, and the content row is what another playlist links to.
  it('gives every row its link and content id, so an edit can name the exact row', () => {
    const rows = readRekordboxPlaylist(db, 'factory')
    expect(rows.map((r) => [r.linkId, r.contentId])).toEqual([
      ['link-0', 'c1'],
      ['link-1', 'sep'],
      ['link-2', 'c2'],
      ['link-3', 'c3'],
    ])
  })
})

describe('entryPath', () => {
  // rekordbox on Windows stores C:/... while a file dropped on Surco arrives as C:\...;
  // spelt differently, one file would load as two rows.
  it('gives a Windows path the separators a dropped file has', () => {
    expect(entryPath('C:/Users/dj/Music/a.wav', win32)).toBe('C:\\Users\\dj\\Music\\a.wav')
  })

  it('leaves a macOS path as rekordbox stored it', () => {
    expect(entryPath('/Volumes/Public/Music/a.wav', posix)).toBe('/Volumes/Public/Music/a.wav')
  })

  it('keeps an empty path empty instead of turning it into the current folder', () => {
    expect(entryPath('', posix)).toBe('')
  })
})

describe('readRekordboxPlaylistWithPreview', () => {
  const share = '/Users/dj/Library/Pioneer/rekordbox/share'
  let pdb: NonNullable<ReturnType<typeof openRekordboxDb>>

  beforeAll(async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'surco-rbpv-')), 'master.db')
    writeRekordboxPlaylistFixture(path, {
      content: [
        {
          ...NIGHT,
          ArtistID: 'a1',
          ImagePath: '/PIONEER/Artwork/abc/def/artwork.jpg',
          AnalysisDataPath: '/PIONEER/USBANLZ/p1/q1/ANLZ0000.DAT',
        },
        { ...PLAY, ImagePath: '/../../../../etc/artwork.jpg', AnalysisDataPath: '/../x.DAT' },
        SEP,
        SPOTIFY,
      ],
      keys: [
        { ID: 'k1', ScaleName: '4B' },
        { ID: 'k2', ScaleName: '8A' },
      ],
      artists: [{ ID: 'a1', Name: 'Rebel Vision' }],
      playlists: [{ ID: 'p', Name: 'P', Attribute: 0, ParentID: 'root', Seq: 1 }],
      links: [
        { PlaylistID: 'p', ContentID: 'c1', TrackNo: 1 },
        { PlaylistID: 'p', ContentID: 'sep', TrackNo: 2 },
        { PlaylistID: 'p', ContentID: 'c2', TrackNo: 3 },
        { PlaylistID: 'p', ContentID: 'c3', TrackNo: 4 },
      ],
      cueRows: [
        { ID: 'q2', ContentID: 'c1', InMsec: 64000, Kind: 2, ColorTableIndex: 22 },
        { ID: 'q1', ContentID: 'c1', InMsec: 1000, Kind: 1, ColorTableIndex: 1 },
        { ID: 'q3', ContentID: 'c1', InMsec: 32000, Kind: 0, ColorTableIndex: null },
      ],
    })
    const opened = openRekordboxDb(path, { readonly: true })
    if (!opened) throw new Error('fixture did not open')
    pdb = opened
  })

  afterAll(() => pdb.close())

  const onlyMedium = (p: string): boolean => p.endsWith('artwork_m.jpg')

  it('gives a row what the list paints first, so it never waits for the file', () => {
    const [night] = readRekordboxPlaylistWithPreview(pdb, share, 'p', onlyMedium)
    expect(night.preview).toEqual({
      title: 'Night Train (Extended Mix)',
      artist: 'Rebel Vision',
      durationSec: 256,
      coverUrl: mediaUrl(join(share, 'PIONEER/Artwork/abc/def/artwork_m.jpg')),
      analysisPath: join(share, 'PIONEER/USBANLZ/p1/q1/ANLZ0000.DAT'),
      cues: [
        { ms: 1000, kind: 1 },
        { ms: 32000, kind: 0 },
        { ms: 64000, kind: 2 },
      ],
    })
  })

  it('keeps the entries readRekordboxPlaylist gives, separators and streaming rows without a preview', () => {
    const rows = readRekordboxPlaylistWithPreview(pdb, share, 'p', onlyMedium)
    expect(rows.map((r) => [r.separator, r.path === null, r.preview !== undefined])).toEqual([
      [false, false, true],
      [true, false, false],
      [false, false, true],
      [false, true, false],
    ])
    expect(rows[0].meta).toEqual({ bpm: '150', key: '4B' })
  })

  it('names no file outside the share folder, so a crafted row cannot reach the disk', () => {
    const [, , play] = readRekordboxPlaylistWithPreview(pdb, share, 'p', () => true)
    expect(play.preview?.coverUrl).toBeUndefined()
    expect(play.preview?.analysisPath).toBeUndefined()
    expect(play.preview?.artist).toBe('')
  })
})

describe('coverFileOf', () => {
  const share = '/s'

  it('prefers the 240 px copy rekordbox keeps for its own browser', () => {
    expect(coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', () => true)).toBe(
      join(share, 'PIONEER/Artwork/a/b/artwork_m.jpg'),
    )
  })

  it('falls back to the full image when the small one is missing', () => {
    expect(
      coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', (p) => !p.endsWith('_m.jpg')),
    ).toBe(join(share, 'PIONEER/Artwork/a/b/artwork.jpg'))
  })

  it('gives nothing when rekordbox has no artwork file for the track', () => {
    expect(coverFileOf(share, '/PIONEER/Artwork/a/b/artwork.jpg', () => false)).toBeNull()
    expect(coverFileOf(share, null, () => true)).toBeNull()
  })
})
