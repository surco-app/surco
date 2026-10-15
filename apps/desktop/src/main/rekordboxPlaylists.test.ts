import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openRekordboxDb } from './rekordboxDb'
import { readRekordboxPlaylist, readRekordboxTree } from './rekordboxPlaylists'
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
})
