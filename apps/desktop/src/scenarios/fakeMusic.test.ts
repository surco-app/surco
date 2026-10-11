import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', async () => (await import('./electronFake')).electronFake())

import * as realArtwork from '../main/appleMusicArtwork'
import * as realMusic from '../main/applemusic'
import { coverThumbUrlForBytes } from '../main/coverThumbs'
import type { TrackMetadata } from '../shared/types'
import { scenarioRoot } from './electronFake'
import { appleMusicModule, artworkModule, music, playlistsModule } from './fakeMusic'

const dir = join(scenarioRoot, 'fake-music')
mkdirSync(dir, { recursive: true })
const file = (name: string) => {
  const path = join(dir, name)
  writeFileSync(path, name)
  return path
}
const fake = appleMusicModule(realMusic)
const artwork = artworkModule(realArtwork)

const meta = (fields: Partial<TrackMetadata>): TrackMetadata => ({
  title: '',
  artist: '',
  album: '',
  albumArtist: '',
  year: '',
  genre: '',
  grouping: '',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
  ...fields,
})

beforeEach(() => music.reset())

describe('the fake Music library answers like the real scripts', () => {
  it('lists streaming rows in the membership dump but only file tracks in the review', async () => {
    const own = music.addEntry({
      location: file('own.aiff'),
      title: 'Plastic Dreams',
      artist: 'Jaydee',
      durationSec: 486.55,
      dateAdded: new Date(2026, 8, 25, 8, 47, 13).toISOString(),
    })
    music.addEntry({ title: 'Streamed', artist: 'Someone', durationSec: 200 })

    expect(await fake.dumpAppleMusicLibrary()).toEqual([
      {
        title: 'Plastic Dreams',
        artist: 'Jaydee',
        durationSec: 487,
        persistentId: own.persistentId,
      },
      expect.objectContaining({ title: 'Streamed', durationSec: 200 }),
    ])
    expect(await fake.dumpMusicReview()).toEqual([
      expect.objectContaining({
        persistentId: own.persistentId,
        title: 'Plastic Dreams',
        dateAdded: new Date(2026, 8, 25, 8, 47, 13).toISOString(),
      }),
    ])
  })

  it('deletes only with the confirmed label, ignoring case as AppleScript does', async () => {
    const path = file('old.mp3')
    const old = music.addEntry({ location: path, title: 'Song', artist: 'Band' })

    await expect(fake.deleteFromAppleMusic(old.persistentId, 'Band - Other')).rejects.toThrow(
      'applemusic-delete-mismatch',
    )
    await expect(
      fake.deleteFromAppleMusic(old.persistentId, 'Band - Song', '/elsewhere.mp3'),
    ).rejects.toThrow('applemusic-delete-mismatch')
    expect(music.entry(old.persistentId)).toBeDefined()

    expect(await fake.deleteFromAppleMusic(old.persistentId, 'band - song', path)).toBe(path)
    expect(await fake.deleteFromAppleMusic(old.persistentId, 'Band - Song')).toBeNull()
  })

  it('reports a moved file as no file, the way Music answers a dead reference', async () => {
    const gone = music.addEntry({ location: join(dir, 'moved.aiff'), title: 'T', artist: 'A' })
    expect(await fake.appleMusicEntryLocation(gone.persistentId)).toBe('')
    expect(await fake.deleteFromAppleMusic(gone.persistentId, 'A - T')).toBe('')
  })

  it('updates every field of a live entry and returns null once it is gone', async () => {
    const entry = music.addEntry({
      location: file('u.aiff'),
      title: 'T',
      year: 1999,
      grouping: 'x',
    })
    expect(
      await fake.updateInAppleMusic(entry.persistentId, meta({ title: ' New ', artist: 'A' })),
    ).toBe(entry.persistentId)
    expect(music.entry(entry.persistentId)).toMatchObject({ title: 'New', year: 0, grouping: '' })

    expect(await fake.updateInAppleMusic('00000000000000FF', meta({ title: 'T' }))).toBeNull()
  })

  it('moves the kept copy into plain playlists only, never into a smart one', async () => {
    const old = music.addEntry({ location: file('a.mp3'), title: 'S', artist: 'A' })
    const keep = music.addEntry({ location: file('a.aiff'), title: 'S', artist: 'A' })
    const plain = music.addPlaylist({ name: 'Warmup', entries: [old.persistentId] })
    const smart = music.addPlaylist({ name: 'Rules', smart: true, entries: [old.persistentId] })

    expect(
      await fake.transferPlaylists(old.persistentId, keep.persistentId, 'A - X', 'A - S'),
    ).toBe('mismatch')
    expect(
      await fake.transferPlaylists(old.persistentId, keep.persistentId, 'A - S', 'A - S'),
    ).toBe('1\t0')
    expect(music.playlist(plain.persistentId)?.entries).toEqual([
      old.persistentId,
      keep.persistentId,
    ])
    expect(music.playlist(smart.persistentId)?.entries).toEqual([old.persistentId])
    expect(
      await fake.transferPlaylists('00000000000000FF', keep.persistentId, 'A - S', 'A - S'),
    ).toBe('missing')
  })

  it('counts streaming rows as missing and keeps only ratings the user gave', async () => {
    const playlists = await playlistsModule()
    const path = file('p.wav')
    const own = music.addEntry({
      location: path,
      grouping: 'Bases',
      rating: 80,
      ratingKind: 'user',
    })
    const computed = music.addEntry({ location: file('q.wav'), rating: 60 })
    const streamed = music.addEntry({ title: 'Cloud' })
    const list = music.addPlaylist({
      name: 'Set',
      folder: 'Gigs',
      entries: [own.persistentId, computed.persistentId, streamed.persistentId],
    })

    expect(await playlists.dumpAppleMusicPlaylists()).toEqual([
      { name: 'Set', count: 3, persistentId: list.persistentId, folder: 'Gigs' },
    ])
    const tracks = await playlists.readAppleMusicPlaylist(list.persistentId)
    expect(tracks.missing).toBe(1)
    expect(tracks.persistentIds[path]).toBe(own.persistentId)
    expect(tracks.meta[path]).toEqual({ grouping: 'Bases', rating: 80 })
    expect(tracks.meta[tracks.paths[1]]).toEqual({})
  })

  it('finds a loaded file through the real title-then-location lookup', async () => {
    const path = file('t.aiff')
    const entry = music.addEntry({ location: path, title: 'This Rap', artist: 'DJ Ter' })

    expect(await fake.musicFileEntries([{ path, title: 'this rap' }], true)).toEqual({
      consulted: true,
      entries: {
        [path]: [
          expect.objectContaining({ persistentId: entry.persistentId, label: 'DJ Ter - This Rap' }),
        ],
      },
    })
    music.state.running = false
    expect(await fake.musicFileEntries([{ path, title: 'This Rap' }], false)).toEqual({
      consulted: false,
      entries: {},
    })
    expect(await fake.musicFileLocations()).toEqual([{ persistentId: entry.persistentId, path }])
    music.state.changeNextLocationsRead = true
    await expect(fake.musicFileLocations()).rejects.toThrow('music-library-changed')
  })

  it('guards a field write on the value the review read', async () => {
    const entry = music.addEntry({ location: file('f.aiff'), genre: 'House ' })
    expect(await fake.setAppleMusicField(entry.persistentId, 'genre', 'house', 'House')).toBe(
      'mismatch',
    )
    expect(await fake.setAppleMusicField(entry.persistentId, 'genre', 'House ', 'House')).toBe(
      'set',
    )
    expect(await fake.setAppleMusicField('00000000000000FF', 'genre', 'a', 'b')).toBe('missing')
  })

  it('writes the entry artwork to the job path and hands back a thumbnail url', async () => {
    const entry = music.addEntry({ location: file('c.aiff'), artwork: file('cover.jpg') })
    const outPath = join(dir, 'out.jpg')
    const [cover] = await artwork.fetchAppleMusicArtwork([
      { persistentId: entry.persistentId, outPath },
      { persistentId: '00000000000000FF', outPath: join(dir, 'none.jpg') },
    ])
    expect(cover.path).toBe(outPath)
    expect(cover.url).toBe(await coverThumbUrlForBytes(readFileSync(outPath)))
    expect(readFileSync(outPath, 'utf8')).toBe('cover.jpg')
  })

  it('fails loud on any osascript the fake does not answer', async () => {
    await expect(fake.runOsascript('tell application "Music" to play')).rejects.toThrow(
      'scenario: unexpected osascript',
    )
  })
})
