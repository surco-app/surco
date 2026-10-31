// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { ReviewEntry } from '../../../shared/types'
import { duplicateGroups } from './duplicates'
import { musicSource, scopedMusicSource, scopeMusicEntries } from './reviewSource'

function setApi(over: Partial<Record<keyof Api, unknown>>) {
  ;(window as unknown as { api: unknown }).api = over
}
afterEach(() => vi.restoreAllMocks())

describe('musicSource', () => {
  // Main and every Music script still speak persistent IDs; only the renderer's engine
  // moved to a neutral id, so the mapping must be exact in both directions.
  it('sends persistent IDs to Music and hands back ids', async () => {
    const applyMusicFixes = vi.fn().mockResolvedValue([
      {
        persistentId: 'C',
        path: '/m/c.mp3',
        fixes: [{ persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ])
    setApi({ applyMusicFixes })
    const out = await musicSource.applyFixes([
      { id: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(applyMusicFixes).toHaveBeenCalledWith([
      { persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(out).toEqual([
      {
        id: 'C',
        musicId: 'C',
        path: '/m/c.mp3',
        fixes: [{ id: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ])
  })

  it('loads the library as entries keyed by persistent ID, with nothing skipped', async () => {
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue([
        {
          persistentId: 'A',
          title: 'T',
          artist: 'X',
          albumArtist: '',
          album: '',
          genre: '',
          durationSec: 3,
        },
      ]),
    })
    expect(await musicSource.load()).toEqual({
      entries: [
        { id: 'A', title: 'T', artist: 'X', albumArtist: '', album: '', genre: '', durationSec: 3 },
      ],
      skipped: 0,
    })
  })

  it('stops removing at a cancel and tells the libraries nothing', async () => {
    const removeMusicDuplicate = vi.fn().mockResolvedValue({
      outcome: 'removed',
      playlists: 0,
      fileTrashed: false,
      pair: { from: '/m/q.aiff', to: '/m/p.aiff', shared: false },
    })
    const replaceDuplicatesInLibraries = vi.fn()
    setApi({ removeMusicDuplicate, replaceDuplicatesInLibraries })
    let cancelled = false
    const run = await musicSource.removeCopies(
      [
        { removeId: 'Q', keepId: 'P', label: 'Ann - Song', keepLabel: 'Ann - Song' },
        { removeId: 'R', keepId: 'P', label: 'Ann - Song', keepLabel: 'Ann - Song' },
      ],
      {
        isCancelled: () => cancelled,
        onStep: () => {},
        onDone: () => {
          cancelled = true
        },
        onLibraries: () => {},
      },
    )
    expect(removeMusicDuplicate).toHaveBeenCalledTimes(1)
    expect(removeMusicDuplicate).toHaveBeenCalledWith({
      removePid: 'Q',
      keepPid: 'P',
      label: 'Ann - Song',
      keepLabel: 'Ann - Song',
    })
    expect(replaceDuplicatesInLibraries).not.toHaveBeenCalled()
    expect(run.librariesUntouched).toBe(true)
  })
})

const entry = (id: string, artist: string, title: string, durationSec?: number): ReviewEntry => ({
  id,
  artist,
  title,
  albumArtist: '',
  album: '',
  genre: '',
  ...(durationSec !== undefined && { durationSec }),
})
const library = [
  entry('01', 'DJ Lara', 'Gold', 300),
  entry('02', 'DJ Lara', 'Gold', 301),
  entry('03', 'DJ Lara', 'Gold', 420),
  entry('04', 'Dj Lara', 'Iron'),
  entry('05', 'Ana', 'Copper'),
  entry('06', 'Bo', 'Lead'),
  entry('07', 'Bo', 'Lead'),
]
const playlist = new Set(['01', '05'])
const toItem = (e: ReviewEntry) => ({
  id: e.id,
  artist: e.artist,
  title: e.title,
  durationSec: e.durationSec,
})

describe('scopeMusicEntries', () => {
  // Reviewing a playlist is about that playlist: a misspelling elsewhere in the library is
  // not what the DJ opened it for, and fixing it would touch tracks they did not pick.
  it('keeps only the playlist tracks when reviewing its metadata', () => {
    expect(scopeMusicEntries(library, playlist, 'tracks').map((e) => e.id)).toEqual(['01', '05'])
  })

  // The copy worth deleting usually sits outside the playlist, so a playlist's duplicates
  // are looked for in the whole library; the playlist's own tracks stay so a playlist
  // without copies opens on "all clear", not on "your library is empty".
  it('adds every library entry of the same recording as a playlist track when showing duplicates', () => {
    expect(scopeMusicEntries(library, playlist, 'duplicates').map((e) => e.id)).toEqual([
      '01',
      '02',
      '03',
      '05',
    ])
  })

  // A group the user ignored in a whole-library review is remembered by a key built from its
  // members; cutting a recording short would give the group a new key and bring it back.
  it('builds for the playlist tracks the same duplicate groups, keys included, as the whole library', () => {
    const whole = duplicateGroups(library.map(toItem))
    const scoped = duplicateGroups(scopeMusicEntries(library, playlist, 'duplicates').map(toItem))
    expect(scoped).toEqual(whole.filter((g) => g.ids.some((id) => playlist.has(id))))
    expect(scoped.flatMap((g) => g.ids)).not.toContain('06')
  })
})

describe('scopedMusicSource', () => {
  // One dump of the library, as the whole-library review reads it, then narrowed here: no
  // second AppleScript to keep in step.
  it('reads the library once and hands the review only the scoped entries', async () => {
    const loadMusicReview = vi
      .fn()
      .mockResolvedValue(library.map(({ id, ...rest }) => ({ persistentId: id, ...rest })))
    setApi({ loadMusicReview })
    const source = scopedMusicSource(playlist, 'tracks')
    const loaded = await source.load()
    expect(loaded.entries.map((e) => e.id)).toEqual(['01', '05'])
    expect(loadMusicReview).toHaveBeenCalledTimes(1)
    expect(loadMusicReview).toHaveBeenCalledWith()
  })

  // Everything but the read is the Music review as it was: the fixes still go to Music.
  it('writes to Music exactly as the whole-library review does', () => {
    const source = scopedMusicSource(playlist, 'duplicates')
    expect(source.kind).toBe('music')
    expect(source.applyFixes).toBe(musicSource.applyFixes)
    expect(source.removeCopies).toBe(musicSource.removeCopies)
    expect(source.revertMusic).toBe(musicSource.revertMusic)
  })
})

// Damage is a list review filter only: the Music review has neither a scan nor a repair.
describe('musicSource damage', () => {
  it('offers no damage scan or repair', () => {
    expect(musicSource.loadDamage).toBeUndefined()
    expect(musicSource.repairDamage).toBeUndefined()
  })
})
