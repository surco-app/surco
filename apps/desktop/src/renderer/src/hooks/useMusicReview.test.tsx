// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { MusicReviewEntry } from '../../../shared/types'
import { useMusicReview } from './useMusicReview'

const e = (
  persistentId: string,
  artist: string,
  extra: Partial<MusicReviewEntry> = {},
): MusicReviewEntry => ({
  persistentId,
  title: `T${persistentId}`,
  artist,
  albumArtist: '',
  album: '',
  genre: '',
  ...extra,
})
const LIB = [e('A', 'DJ Lara'), e('B', 'DJ Lara'), e('C', 'Dj Lara')]

function setApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  const api = {
    loadMusicReview: vi.fn<Api['loadMusicReview']>().mockResolvedValue(LIB),
    applyMusicFixes: vi.fn<Api['applyMusicFixes']>().mockResolvedValue([
      {
        persistentId: 'C',
        path: '/m/c.mp3',
        fixes: [{ persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
        music: ['set'],
        file: 'written',
        written: ['artist'],
        backupId: 'b1',
      },
    ]),
    syncLibraryTags: vi.fn<Api['syncLibraryTags']>().mockResolvedValue(undefined),
    cancelMusicFixes: vi.fn<Api['cancelMusicFixes']>().mockResolvedValue(undefined),
    onMusicFixProgress: vi.fn<Api['onMusicFixProgress']>().mockReturnValue(() => {}),
    setMusicField: vi.fn<Api['setMusicField']>().mockResolvedValue('set'),
    removeMusicDuplicate: vi
      .fn<Api['removeMusicDuplicate']>()
      .mockResolvedValue({ outcome: 'removed', playlists: 0, fileTrashed: true }),
    appleMusicEntryLocation: vi.fn<Api['appleMusicEntryLocation']>().mockResolvedValue('/m/x.aiff'),
    trashRestore: vi.fn<Api['trashRestore']>().mockResolvedValue({ restoredTo: '/m/c.mp3' }),
    ...over,
  }
  ;(window as unknown as { api: unknown }).api = api
  return api
}

const props = (over = {}) => ({
  initialFilter: 'all' as const,
  ignored: [] as string[],
  saveIgnored: vi.fn(),
  onFilesChanged: vi.fn(),
  ...over,
})

const ready = async (over = {}) => {
  const hook = renderHook(() => useMusicReview(props(over)))
  await waitFor(() => expect(hook.result.current.status).toBe('ready'))
  return hook
}

const DUPS = [
  e('P', 'Ann', { title: 'Song', durationSec: 200 }),
  e('Q', 'Ann', { title: 'Song', durationSec: 201 }),
]

afterEach(() => vi.restoreAllMocks())

describe('useMusicReview', () => {
  it('reads the library and offers the common spelling', async () => {
    setApi()
    const { result } = await ready()
    const [g] = result.current.spelling
    expect(result.current.choice(g.key)).toBe('DJ Lara')
  })

  it('says the library is empty instead of showing an empty review', async () => {
    setApi({ loadMusicReview: vi.fn().mockResolvedValue([]) })
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('empty'))
  })

  it('reports an error when the library cannot be read', async () => {
    setApi({ loadMusicReview: vi.fn().mockRejectedValue(new Error('x')) })
    const { result } = renderHook(() => useMusicReview(props()))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('hides a group the user ignored and saves it', async () => {
    setApi()
    const saveIgnored = vi.fn()
    const { result } = await ready({ saveIgnored })
    const key = result.current.spelling[0].key
    act(() => result.current.ignore(key))
    expect(saveIgnored).toHaveBeenCalledWith([key])
    expect(result.current.spelling).toEqual([])
  })

  // A corrupt settings.json can hold anything; the review must still open.
  it('treats a non-array ignored list as empty', async () => {
    setApi()
    const { result } = await ready({ ignored: 'oops' })
    expect(result.current.spelling).toHaveLength(1)
  })

  // Nothing is written until the user applies: staging a group only fills the tray.
  it('writes only the staged groups, rereads and reports the files it changed', async () => {
    const api = setApi()
    const onFilesChanged = vi.fn()
    const { result } = await ready({ onFilesChanged })
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    expect(api.applyMusicFixes).not.toHaveBeenCalled()
    expect(result.current.summary).toMatchObject({ tracks: 1, byField: { artist: 1 } })
    await act(() => result.current.apply())
    expect(api.applyMusicFixes).toHaveBeenCalledWith([
      { persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    expect(api.loadMusicReview).toHaveBeenCalledTimes(2)
    expect(onFilesChanged).toHaveBeenCalledWith(['/m/c.mp3'])
    expect(api.syncLibraryTags).toHaveBeenCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(result.current.status).toBe('done')
  })

  it('undoes a run by restoring the backups and setting Music back', async () => {
    const api = setApi()
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.trashRestore).toHaveBeenCalledWith('b1')
    expect(api.setMusicField).toHaveBeenCalledWith('C', 'artist', 'DJ Lara', 'Dj Lara')
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
  })

  it('never stages a tie until the user picks a spelling', async () => {
    setApi({
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([e('A', 'Rachel Auburn'), e('B', 'Rahcel Auburn')]),
    })
    const { result } = await ready()
    const key = result.current.spelling[0].key
    act(() => result.current.toggleStaged(key))
    expect(result.current.staged.has(key)).toBe(false)
    act(() => result.current.choose(key, 'Rachel Auburn'))
    act(() => result.current.toggleStaged(key))
    expect(result.current.staged.has(key)).toBe(true)
  })

  // The main-side cancel flag is shared, so two runs at once would cancel each other.
  it('ignores apply and undo while a run is in progress', async () => {
    let finish: (v: never[]) => void = () => {}
    const api = setApi({
      applyMusicFixes: vi.fn().mockReturnValue(new Promise<never[]>((r) => (finish = r))),
    })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.apply()
    })
    await waitFor(() => expect(result.current.status).toBe('applying'))
    await act(async () => {
      await result.current.apply()
      await result.current.undo()
    })
    expect(api.applyMusicFixes).toHaveBeenCalledTimes(1)
    expect(api.trashRestore).not.toHaveBeenCalled()
    await act(async () => {
      finish([])
      await first
    })
    expect(result.current.status).toBe('done')
  })

  // A typo group and a case group over the same values would write conflicting targets.
  it('unstages a group of the same field that shares a value when another is staged', async () => {
    setApi({
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([
          e('A', 'Dj Lara'),
          e('B', 'DJ Lara'),
          e('C', 'dj lara'),
          e('D', 'DJ Larra'),
        ]),
    })
    const { result } = await ready()
    const groups = result.current.spelling.filter((g) => g.field === 'artist')
    expect(groups.length).toBeGreaterThan(1)
    const [first, second] = groups
    act(() => result.current.choose(first.key, first.variants[0].value))
    act(() => result.current.choose(second.key, second.variants[0].value))
    act(() => result.current.toggleStaged(first.key))
    act(() => result.current.toggleStaged(second.key))
    expect([...result.current.staged]).toEqual([second.key])
  })

  it('suggests keeping the first lossless copy and asks formats only for duplicate members', async () => {
    const api = setApi({
      loadMusicReview: vi.fn().mockResolvedValue([...DUPS, e('Z', 'Solo')]),
      appleMusicEntryLocation: vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => (pid === 'Q' ? '/m/q.flac' : '/m/p.mp3')),
    })
    const { result } = await ready()
    await waitFor(() =>
      expect(result.current.duplicates[0].formats).toEqual({ P: 'MP3', Q: 'FLAC' }),
    )
    expect(api.appleMusicEntryLocation).toHaveBeenCalledTimes(2)
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('Q')
  })

  it('removes the other copies of a staged duplicate with both labels', async () => {
    const api = setApi({ loadMusicReview: vi.fn().mockResolvedValue(DUPS) })
    const { result } = await ready()
    const key = result.current.duplicates[0].group.key
    act(() => result.current.toggleStaged(key))
    expect(result.current.summary.duplicates).toBe(1)
    await act(() => result.current.apply())
    expect(api.applyMusicFixes).not.toHaveBeenCalled()
    expect(api.removeMusicDuplicate).toHaveBeenCalledWith({
      removePid: 'Q',
      keepPid: 'P',
      label: 'Ann - Song',
      keepLabel: 'Ann - Song',
    })
    expect(result.current.lastRun?.removed).toHaveLength(1)
  })

  it('does not stage a version group on its own', async () => {
    setApi({
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([
          e('P', 'Ann', { title: 'Song', durationSec: 200 }),
          e('Q', 'Ann', { title: 'Song', durationSec: 300 }),
        ]),
    })
    const { result } = await ready()
    expect(result.current.duplicates[0].group.kind).toBe('version')
    expect(result.current.staged.size).toBe(0)
  })

  it('finishes as done and records a failure when a removal or the sync rejects', async () => {
    const api = setApi({
      loadMusicReview: vi.fn().mockResolvedValue([...LIB, ...DUPS]),
      removeMusicDuplicate: vi.fn().mockRejectedValue(new Error('boom')),
      syncLibraryTags: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const { result } = await ready()
    for (const g of result.current.spelling) act(() => result.current.toggleStaged(g.key))
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(api.removeMusicDuplicate).toHaveBeenCalled()
    expect(result.current.status).toBe('done')
    expect(result.current.lastRun?.removed).toEqual([
      { outcome: 'failed', playlists: 0, fileTrashed: false },
    ])
  })
})
