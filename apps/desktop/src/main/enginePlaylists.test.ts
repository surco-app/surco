import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { mediaPathFromUrl } from '../shared/media'
import { RECENTLY_ADDED_ID } from '../shared/recentlyAdded'
import { analysedTrack } from './enginePerformanceFixture'
import {
  artworkFileName,
  openEngineDb,
  readEnginePlaylist,
  readEngineRecentCount,
  readEngineTree,
} from './enginePlaylists'
import {
  type EngineFixture,
  engineDbPath,
  writeEngineLibraryFixture,
} from './enginePlaylistsFixture'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])

async function library(data: EngineFixture): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'surco-enginepl-'))
  writeEngineLibraryFixture(dir, data).close()
  return dir
}

function opened(dir: string) {
  const db = openEngineDb(dir)
  if (!db) throw new Error('fixture did not open')
  return db
}

const TRACKS: EngineFixture['tracks'] = [
  { id: 1, path: '../Music/Rebel Vision/Night Train.aiff', title: 'Night Train', length: 256 },
  { id: 2, path: '../Music/Play.mp3', title: 'Play', length: 200 },
  { id: 3, path: '../Music/Third.flac', title: 'Third', length: 300 },
]

describe('readEngineTree', () => {
  it('nests crates under their folders and orders siblings by the nextListId chain, as Engine shows them', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [
        { id: 1, title: 'Warm up', parentListId: 0, nextListId: 0 },
        { id: 2, title: 'Peak', parentListId: 0, nextListId: 1 },
        { id: 3, title: 'Sets', parentListId: 0, nextListId: 2 },
        { id: 4, title: '2026', parentListId: 3, nextListId: 0 },
        { id: 5, title: '2025', parentListId: 3, nextListId: 4 },
      ],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 2, nextEntityId: 0 },
        { id: 3, listId: 4, trackId: 3, nextEntityId: 0 },
      ],
    })
    const db = opened(dir)
    expect(readEngineTree(db)).toEqual([
      {
        id: '3',
        name: 'Sets',
        kind: 'folder',
        count: 2,
        children: [
          { id: '5', name: '2025', kind: 'playlist', count: 0 },
          { id: '4', name: '2026', kind: 'playlist', count: 1 },
        ],
      },
      { id: '2', name: 'Peak', kind: 'playlist', count: 0 },
      { id: '1', name: 'Warm up', kind: 'playlist', count: 2 },
    ])
    db.close()
  })

  it('still lists every crate when the sibling chain is cyclic, so a damaged library never hangs the tree or hides crates', async () => {
    const dir = await library({
      tracks: [],
      playlists: [
        { id: 1, title: 'A', parentListId: 0, nextListId: 2 },
        { id: 2, title: 'B', parentListId: 0, nextListId: 1 },
        { id: 3, title: 'C', parentListId: 0, nextListId: 9 },
      ],
      entities: [],
    })
    const db = opened(dir)
    expect(readEngineTree(db).map((n) => n.name)).toEqual(['C', 'A', 'B'])
    db.close()
  })

  it('counts only entries whose track is in the library, so the number matches the rows the list will show', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 99, nextEntityId: 0 },
      ],
    })
    const db = opened(dir)
    expect(readEngineTree(db)[0].count).toBe(1)
    db.close()
  })
})

describe('readEnginePlaylist', () => {
  it('returns the rows in the nextEntityId order, not the order they were added', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 0 },
        { id: 2, listId: 1, trackId: 2, nextEntityId: 3 },
        { id: 3, listId: 1, trackId: 3, nextEntityId: 1 },
      ],
    })
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(rows.map((r) => r.preview?.title)).toEqual(['Play', 'Third', 'Night Train'])
    db.close()
  })

  it('still returns every row when the entity chain loops, so a damaged playlist never hangs the read', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 2, nextEntityId: 3 },
        { id: 3, listId: 1, trackId: 3, nextEntityId: 1 },
      ],
    })
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(rows.map((r) => r.preview?.title)).toEqual(['Night Train', 'Play', 'Third'])
    db.close()
  })

  it('resolves each path against the library folder, which is how Engine stores them', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [{ id: 1, listId: 1, trackId: 1, nextEntityId: 0 }],
    })
    const db = opened(dir)
    const [row] = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(row.path).toBe(resolve(dir, '../Music/Rebel Vision/Night Train.aiff'))
    db.close()
  })

  it('keeps a row Engine has no file for, with no path, so it counts as missing like a rekordbox streaming row', async () => {
    const dir = await library({
      tracks: [{ id: 1, path: null, title: 'Streamed' }],
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [{ id: 1, listId: 1, trackId: 1, nextEntityId: 0 }],
    })
    const db = opened(dir)
    expect(readEnginePlaylist(db, dir, '1', join(dir, 'art'))).toEqual([
      { path: null, separator: false, meta: {} },
    ])
    db.close()
  })

  it('gives a row what the list paints first, so it never waits for the file', async () => {
    const dir = await library({
      tracks: [
        {
          id: 1,
          path: 'Music/a.mp3',
          title: ' Night Train ',
          artist: 'Rebel Vision',
          length: 256,
          bpm: 128,
          bpmAnalyzed: 127.996,
          rating: 80,
          albumArtId: 2,
        },
      ],
      art: [{ id: 2, bytes: JPEG }],
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [{ id: 1, listId: 1, trackId: 1, nextEntityId: 0 }],
    })
    const db = opened(dir)
    const [row] = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(row.meta).toEqual({ bpm: '128', rating: 80 })
    expect(row.preview).toMatchObject({
      title: 'Night Train',
      artist: 'Rebel Vision',
      durationSec: 256,
      cues: [],
    })
    const cover = mediaPathFromUrl(row.preview?.coverUrl as string)
    expect(readFileSync(cover)).toEqual(Buffer.from(JPEG))
    db.close()
  })

  it('names each row’s Engine track, apart from rekordbox ids, and shows its hot cues on the row before the editor opens', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 7, listId: 1, trackId: 3, nextEntityId: 8 },
        { id: 8, listId: 1, trackId: 1, nextEntityId: 0 },
      ],
      performance: [
        analysedTrack(3, [null, { label: 'Cue 2', sample: 44100 * 4, argb: 0xff28e214 }]),
      ],
    })
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(rows.map((r) => r.contentId)).toEqual(['engine:3', 'engine:1'])
    expect(rows.map((r) => r.preview?.cues)).toEqual([[{ ms: 4000, kind: 2, color: 22 }], []])
    db.close()
  })

  it('marks the rows Engine has not analysed, so the list can say so before the editor opens', async () => {
    const dir = await library({
      tracks: TRACKS,
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 2, nextEntityId: 0 },
      ],
      performance: [analysedTrack(2)],
    })
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(rows.map((r) => r.preview?.unanalysed)).toEqual([true, undefined])
    db.close()
  })

  it('finds the cover Engine DJ 4 keeps beside the library, since its database holds only the picture hash', async () => {
    const hash = new Uint8Array(20).fill(0xfb)
    const dir = await library({
      tracks: [{ id: 1, path: 'Music/a.mp3', albumArtId: 2 }],
      artHashes: [{ id: 2, hash }],
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [{ id: 1, listId: 1, trackId: 1, nextEntityId: 0 }],
    })
    mkdirSync(join(dir, 'Artwork'))
    const file = join(dir, 'Artwork', `${Buffer.from(hash).toString('base64url')}.jpg`)
    await writeFile(file, JPEG)
    const db = opened(dir)
    const [row] = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(mediaPathFromUrl(row.preview?.coverUrl as string)).toBe(file)
    db.close()
  })

  it('writes one cover file per picture, however many tracks share it', async () => {
    const dir = await library({
      tracks: [
        { id: 1, path: 'a.mp3', albumArtId: 2 },
        { id: 2, path: 'b.mp3', albumArtId: 2 },
        { id: 3, path: 'c.mp3' },
      ],
      art: [{ id: 2, bytes: JPEG }],
      playlists: [{ id: 1, title: 'P', parentListId: 0, nextListId: 0 }],
      entities: [
        { id: 1, listId: 1, trackId: 1, nextEntityId: 2 },
        { id: 2, listId: 1, trackId: 2, nextEntityId: 3 },
        { id: 3, listId: 1, trackId: 3, nextEntityId: 0 },
      ],
    })
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, '1', join(dir, 'art'))
    expect(readdirSync(join(dir, 'art'))).toHaveLength(1)
    expect(rows[0].preview?.coverUrl).toBe(rows[1].preview?.coverUrl)
    expect(rows[2].preview?.coverUrl).toBeUndefined()
    db.close()
  })

  it('returns nothing for a playlist that is not there, rather than throwing', async () => {
    const dir = await library({ tracks: TRACKS, playlists: [], entities: [] })
    const db = opened(dir)
    expect(readEnginePlaylist(db, dir, '42', join(dir, 'art'))).toEqual([])
    db.close()
  })
})

describe('the recently added list', () => {
  const now = new Date(2026, 9, 21, 12)
  const at = (y: number, m: number, d: number, h = 0) => new Date(y, m, d, h).getTime() / 1000

  async function recentLibrary(): Promise<string> {
    return library({
      tracks: [
        { id: 1, path: 'Music/night.mp3', title: 'Night', dateAdded: at(2026, 9, 20, 9) },
        {
          id: 2,
          path: 'Music/play.mp3',
          title: 'Play',
          artist: 'Fabiola',
          length: 338,
          bpmAnalyzed: 138.07,
          rating: 80,
          albumArtId: 2,
          dateAdded: at(2026, 9, 20, 18),
        },
        { id: 3, path: null, title: 'Streamed', dateAdded: at(2026, 9, 1) },
        { id: 4, path: 'Music/edge.mp3', title: 'Edge', dateAdded: at(2026, 8, 21) },
        { id: 5, path: 'Music/old.mp3', title: 'Old', dateAdded: at(2026, 8, 20, 23) },
        { id: 6, path: 'Music/undated.mp3', title: 'Undated' },
      ],
      art: [{ id: 2, bytes: JPEG }],
      playlists: [],
      entities: [],
    })
  }

  it('lists the tracks that entered the library in the last 30 days, newest first, the order the DJ added them', async () => {
    const dir = await recentLibrary()
    const db = opened(dir)
    const rows = readEnginePlaylist(db, dir, RECENTLY_ADDED_ID, join(dir, 'art'), now)
    expect(rows.map((r) => r.preview?.title ?? null)).toEqual(['Play', 'Night', null, 'Edge'])
    db.close()
  })

  it('counts what the list will show, so the tree number matches its rows', async () => {
    const db = opened(await recentLibrary())
    expect(readEngineRecentCount(db, now)).toBe(4)
    db.close()
  })

  it('gives its rows what any playlist row has, so they open, play and paint alike', async () => {
    const dir = await recentLibrary()
    const db = opened(dir)
    const [play, , streamed] = readEnginePlaylist(db, dir, RECENTLY_ADDED_ID, join(dir, 'art'), now)
    expect(play).toMatchObject({
      path: resolve(dir, 'Music/play.mp3'),
      separator: false,
      meta: { bpm: '138.07', rating: 80 },
      preview: { title: 'Play', artist: 'Fabiola', durationSec: 338, cues: [] },
    })
    expect(readFileSync(mediaPathFromUrl(play.preview?.coverUrl as string))).toEqual(
      Buffer.from(JPEG),
    )
    expect(streamed).toEqual({ path: null, separator: false, meta: {} })
    db.close()
  })
})

describe('openEngineDb', () => {
  it('opens nothing when the library folder has no database, the normal case for a DJ without Engine', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-enginepl-'))
    expect(openEngineDb(dir)).toBeNull()
    expect(openEngineDb('')).toBeNull()
  })

  it('reads a library Engine has open, including what Engine has not yet checkpointed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'surco-enginepl-'))
    const engine = writeEngineLibraryFixture(dir, {
      tracks: [],
      playlists: [],
      entities: [],
      wal: true,
    })
    engine
      .prepare(`INSERT INTO Playlist (id, title, parentListId, nextListId) VALUES (1, 'New', 0, 0)`)
      .run()
    const db = opened(dir)
    expect(readEngineTree(db).map((n) => n.name)).toEqual(['New'])
    db.close()
    engine.close()
  })

  it('leaves no journal behind in a library Engine has closed, since the folder is the DJ’s and may be read-only', async () => {
    const dir = await library({ tracks: [], playlists: [], entities: [], wal: true })
    const before = readdirSync(join(dir, 'Database2'))
    const db = opened(dir)
    readEngineTree(db)
    db.close()
    expect(readdirSync(join(dir, 'Database2'))).toEqual(before)
  })

  it('never writes to the library, so browsing cannot be what damages it', async () => {
    const dir = await library({ tracks: [], playlists: [], entities: [] })
    const db = opened(dir)
    expect(() => db.prepare('DELETE FROM Playlist').run()).toThrow()
    db.close()
  })

  it('fails on a file that is not a database, so the source can say it could not read it', async () => {
    const dir = await library({ tracks: [], playlists: [], entities: [] })
    await writeFile(engineDbPath(dir), 'not a database')
    expect(() => readEngineTree(opened(dir))).toThrow()
    expect(existsSync(`${engineDbPath(dir)}-journal`)).toBe(false)
  })
})

describe('artworkFileName', () => {
  it('names the image as Engine DJ 4 does in its Artwork folder, the hash in URL-safe base64', () => {
    const hash = Buffer.from('f8a7dcaa49e456914f24038b5a9f36c5fcf921b7', 'hex')
    expect(artworkFileName(hash)).toBe('-KfcqknkVpFPJAOLWp82xfz5Ibc')
  })

  it('has no name for a cover kept inside the database, as older libraries store it', () => {
    expect(artworkFileName('3f786850e387550fdab836ed7e6dc881de23001b')).toBeNull()
    expect(artworkFileName(null)).toBeNull()
  })
})
