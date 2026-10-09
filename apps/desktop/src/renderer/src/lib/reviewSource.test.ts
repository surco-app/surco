// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { musicSource } from './reviewSource'

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
