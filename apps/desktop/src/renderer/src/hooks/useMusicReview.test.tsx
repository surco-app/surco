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
    replaceDuplicatesInLibraries: vi
      .fn<Api['replaceDuplicatesInLibraries']>()
      .mockResolvedValue([]),
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
    expect(onFilesChanged).toHaveBeenCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(api.syncLibraryTags).toHaveBeenCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(result.current.status).toBe('done')
  })

  it('undoes a run by restoring the backups and setting Music back', async () => {
    const api = setApi()
    const onFilesChanged = vi.fn()
    const { result } = await ready({ onFilesChanged })
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.trashRestore).toHaveBeenCalledWith('b1')
    expect(api.setMusicField).toHaveBeenCalledWith('C', 'artist', 'DJ Lara', 'Dj Lara')
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
    expect(onFilesChanged).toHaveBeenLastCalledWith([
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
          e('A', 'Alex Cervera'),
          e('B', 'Álex Cervera'),
          e('C', 'Álex Cervera'),
          e('D', 'Álex Cevera'),
        ]),
    })
    const { result } = await ready()
    const groups = result.current.spelling.filter((g) => g.fields.includes('artist'))
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

  // Stop has to stop the whole run: a removal is not undoable, and the user pressed it
  // precisely so nothing more would change.
  it('removes no duplicate once the user stops the run', async () => {
    let finish: (v: never[]) => void = () => {}
    const api = setApi({
      loadMusicReview: vi.fn().mockResolvedValue([...LIB, ...DUPS]),
      applyMusicFixes: vi.fn().mockReturnValue(new Promise<never[]>((r) => (finish = r))),
    })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.apply()
    })
    await waitFor(() => expect(result.current.status).toBe('applying'))
    act(() => result.current.cancel())
    await act(async () => {
      finish([])
      await run
    })
    expect(api.cancelMusicFixes).toHaveBeenCalled()
    expect(api.removeMusicDuplicate).not.toHaveBeenCalled()
  })

  it('stops between removals when the user stops the run', async () => {
    const lib = [
      e('P', 'Ann', { title: 'Song', durationSec: 200 }),
      e('Q', 'Ann', { title: 'Song', durationSec: 201 }),
      e('R', 'Ann', { title: 'Song', durationSec: 202 }),
    ]
    let release: () => void = () => {}
    const removeMusicDuplicate = vi
      .fn<Api['removeMusicDuplicate']>()
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            release = () =>
              r({
                outcome: 'removed',
                playlists: 0,
                fileTrashed: false,
                pair: { from: '/m/q.aiff', to: '/m/p.aiff', shared: false },
              })
          }),
      )
      .mockResolvedValue({ outcome: 'removed', playlists: 0, fileTrashed: true })
    const api = setApi({ loadMusicReview: vi.fn().mockResolvedValue(lib), removeMusicDuplicate })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.apply()
    })
    await waitFor(() => expect(removeMusicDuplicate).toHaveBeenCalledTimes(1))
    act(() => result.current.cancel())
    await act(async () => {
      release()
      await run
    })
    expect(removeMusicDuplicate).toHaveBeenCalledTimes(1)
    expect(api.replaceDuplicatesInLibraries).not.toHaveBeenCalled()
    expect(result.current.lastRun?.librariesUntouched).toBe(true)
  })

  describe('the DJ libraries after removing copies', () => {
    const THREE = [
      e('P', 'Ann', { title: 'Song', durationSec: 200 }),
      e('Q', 'Ann', { title: 'Song', durationSec: 201 }),
      e('R', 'Ann', { title: 'Song', durationSec: 202 }),
    ]
    const removedWith = (from: string, shared = false) => ({
      outcome: 'removed' as const,
      playlists: 0,
      fileTrashed: false,
      pair: { from, to: '/m/p.aiff', shared },
    })

    // One write per library for the whole run, and only once Music no longer has the copies.
    it('hands every removed copy to the libraries in one call after the removals', async () => {
      const calls: string[] = []
      const outcomes = [
        {
          from: '/m/q.aiff',
          rekordbox: 'replaced' as const,
          fileTrashed: true,
          keptForLibrary: false,
        },
        { from: '/m/r.aiff', fileTrashed: false, keptForLibrary: false },
      ]
      const api = setApi({
        loadMusicReview: vi.fn().mockResolvedValue(THREE),
        removeMusicDuplicate: vi
          .fn<Api['removeMusicDuplicate']>()
          .mockImplementationOnce(async () => {
            calls.push('remove')
            return removedWith('/m/q.aiff')
          })
          .mockImplementationOnce(async () => {
            calls.push('remove')
            return removedWith('/m/r.aiff', true)
          }),
        replaceDuplicatesInLibraries: vi.fn(async () => {
          calls.push('replace')
          return outcomes
        }),
      })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      await act(() => result.current.apply())
      expect(calls).toEqual(['remove', 'remove', 'replace'])
      expect(api.replaceDuplicatesInLibraries).toHaveBeenCalledWith([
        { from: '/m/q.aiff', to: '/m/p.aiff', shared: false },
        { from: '/m/r.aiff', to: '/m/p.aiff', shared: true },
      ])
      expect(result.current.lastRun?.replaced).toEqual(outcomes)
    })

    it('calls nothing when no removed copy had a file', async () => {
      const api = setApi({ loadMusicReview: vi.fn().mockResolvedValue(THREE) })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      await act(() => result.current.apply())
      expect(api.replaceDuplicatesInLibraries).not.toHaveBeenCalled()
      expect(result.current.lastRun?.replaced).toEqual([])
      expect(result.current.lastRun?.librariesUntouched).toBeUndefined()
    })

    it('records a failed library step when the call rejects', async () => {
      setApi({
        loadMusicReview: vi.fn().mockResolvedValue(THREE),
        removeMusicDuplicate: vi.fn().mockResolvedValue(removedWith('/m/q.aiff')),
        replaceDuplicatesInLibraries: vi.fn().mockRejectedValue(new Error('boom')),
      })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      await act(() => result.current.apply())
      expect(result.current.status).toBe('done')
      expect(result.current.lastRun).toMatchObject({ librarySync: 'failed', replaced: [] })
    })
  })

  // A failed apply leaves Music in an unknown state; removing copies on top of it would
  // pile an irreversible change onto one the user cannot see.
  it('removes no duplicate when the fixes fail to apply', async () => {
    const api = setApi({
      loadMusicReview: vi.fn().mockResolvedValue([...LIB, ...DUPS]),
      applyMusicFixes: vi.fn().mockRejectedValue(new Error('boom')),
    })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(api.removeMusicDuplicate).not.toHaveBeenCalled()
    expect(result.current.lastRun).toMatchObject({ removed: [], applyError: 'boom' })
  })

  // The removed copy is gone from Music by the end of the run; fixing its spelling first
  // would only write a backup and a file for an entry about to disappear.
  it('plans no spelling fix on a copy the same run removes', async () => {
    const lib = [
      e('A', 'DJ Lara'),
      e('B', 'DJ Lara'),
      e('C', 'Dj Lara', { title: 'Song', durationSec: 200 }),
      e('D', 'Dj Lara', { title: 'Song', durationSec: 201 }),
    ]
    const api = setApi({ loadMusicReview: vi.fn().mockResolvedValue(lib) })
    const { result } = await ready()
    const dup = result.current.duplicates[0].group.key
    act(() => result.current.choose(dup, 'C'))
    act(() => result.current.toggleStaged(dup))
    const spelling = result.current.spelling[0].key
    act(() => result.current.choose(spelling, 'DJ Lara'))
    act(() => result.current.toggleStaged(spelling))
    expect(result.current.summary).toMatchObject({ tracks: 1, duplicates: 1 })
    await act(() => result.current.apply())
    expect(api.applyMusicFixes).toHaveBeenCalledWith([
      { persistentId: 'C', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
  })

  const twoOutcomes = [
    {
      persistentId: 'C',
      path: '/m/c.mp3',
      fixes: [{ persistentId: 'C', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' }],
      music: ['set' as const],
      file: 'written' as const,
      written: ['artist' as const],
      backupId: 'b1',
    },
    {
      persistentId: 'D',
      path: '/m/d.mp3',
      fixes: [{ persistentId: 'D', field: 'artist' as const, from: 'dj lara', to: 'DJ Lara' }],
      music: ['set' as const],
      file: 'written' as const,
      written: ['artist' as const],
      backupId: 'b2',
    },
  ]
  const runTwo = async (over = {}) => {
    const api = setApi({ applyMusicFixes: vi.fn().mockResolvedValue(twoOutcomes), ...over })
    const hook = await ready()
    act(() => hook.result.current.toggleStaged(hook.result.current.spelling[0].key))
    await act(() => hook.result.current.apply())
    return { api, ...hook }
  }

  // A restore is not idempotent, so one failure must not strand the rest of the undo.
  it('keeps undoing after one restore fails and syncs only what was restored', async () => {
    const trashRestore = vi
      .fn<Api['trashRestore']>()
      .mockRejectedValueOnce(new Error('no such trash entry'))
      .mockResolvedValue({ restoredTo: '/m/d.mp3' })
    const { api, result } = await runTwo({ trashRestore })
    await act(() => result.current.undo())
    expect(api.setMusicField).toHaveBeenCalledTimes(1)
    expect(api.setMusicField).toHaveBeenCalledWith('D', 'artist', 'DJ Lara', 'dj lara')
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/d.mp3', fields: { artist: { from: 'DJ Lara', to: 'dj lara' } } },
    ])
    expect(result.current.lastRun).toMatchObject({ undoFailures: 1 })
    expect(result.current.lastRun?.outcomes.map((o) => o.persistentId)).toEqual(['C'])
    expect(result.current.status).toBe('ready')
  })

  // Without its backup the file cannot go back; setting Music and the libraries back
  // anyway would leave them saying one thing and the file another.
  it('leaves a written file with no backup as it is and counts it as not undone', async () => {
    const noBackup = { ...twoOutcomes[0], backupId: undefined }
    const api = setApi({
      applyMusicFixes: vi.fn().mockResolvedValue([noBackup, twoOutcomes[1]]),
    })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.setMusicField).toHaveBeenCalledTimes(1)
    expect(api.setMusicField).toHaveBeenCalledWith('D', 'artist', 'DJ Lara', 'dj lara')
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/d.mp3', fields: { artist: { from: 'DJ Lara', to: 'dj lara' } } },
    ])
    expect(result.current.lastRun).toMatchObject({ undoFailures: 1 })
    expect(result.current.lastRun?.outcomes.map((o) => o.persistentId)).toEqual(['C'])
  })

  // The file is already back after the first try; a second Undo still owes Music its value.
  it('retries setting Music back on a second undo once the file was restored', async () => {
    const setMusicField = vi
      .fn<Api['setMusicField']>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue('set')
    const api = setApi({ setMusicField })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(result.current.lastRun).toMatchObject({ undoFailures: 1 })
    await act(() => result.current.undo())
    expect(setMusicField).toHaveBeenCalledTimes(2)
    expect(api.trashRestore).toHaveBeenCalledTimes(1)
    expect(result.current.lastRun).toBeNull()
  })

  it('keeps the run and reports the files when the reread fails', async () => {
    const loadMusicReview = vi
      .fn<Api['loadMusicReview']>()
      .mockResolvedValueOnce(LIB)
      .mockRejectedValue(new Error('x'))
    const onFilesChanged = vi.fn()
    const api = setApi({ loadMusicReview })
    const { result } = await ready({ onFilesChanged })
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(api.applyMusicFixes).toHaveBeenCalled()
    expect(onFilesChanged).toHaveBeenCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(result.current.lastRun).toMatchObject({ after: null, librarySync: 'ok' })
    expect(result.current.status).toBe('done')
  })

  it('records a failed library sync', async () => {
    const { result } = await runTwo({ syncLibraryTags: vi.fn().mockRejectedValue(new Error('x')) })
    expect(result.current.lastRun?.librarySync).toBe('failed')
  })

  it('says none when no field reached a file', async () => {
    setApi({ applyMusicFixes: vi.fn().mockResolvedValue([]) })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(result.current.lastRun?.librarySync).toBe('none')
  })

  it('ends done and keeps the error when applyMusicFixes rejects', async () => {
    setApi({ applyMusicFixes: vi.fn().mockRejectedValue(new Error('boom')) })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(result.current.status).toBe('done')
    expect(result.current.lastRun).toMatchObject({ outcomes: [], applyError: 'boom' })
  })

  it('keeps a FLAC over an M4A and an MP3', async () => {
    const lib = [...DUPS, e('R', 'Ann', { title: 'Song', durationSec: 200 })]
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue(lib),
      appleMusicEntryLocation: vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => ({ P: '/a.m4a', Q: '/b.mp3', R: '/c.flac' })[pid] ?? ''),
    })
    const { result } = await ready()
    await waitFor(() => expect(Object.keys(result.current.duplicates[0].formats)).toHaveLength(3))
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('R')
  })

  it('keys each duplicate cluster by its smallest member so removing one leaves the other', async () => {
    const lib = [
      e('P', 'Ann', { title: 'Song', durationSec: 100 }),
      e('Q', 'Ann', { title: 'Song', durationSec: 101 }),
      e('R', 'Ann', { title: 'Song', durationSec: 300 }),
      e('S', 'Ann', { title: 'Song', durationSec: 301 }),
    ]
    const loadMusicReview = vi.fn<Api['loadMusicReview']>().mockResolvedValue(lib)
    setApi({ loadMusicReview })
    const { result } = await ready()
    const keys = result.current.duplicates
      .filter((d) => d.group.kind === 'duplicate')
      .map((d) => d.group.key)
    expect(new Set(keys).size).toBe(2)
    const second = keys.find((k) => k.endsWith('#R')) as string
    loadMusicReview.mockResolvedValue(lib.filter((x) => x.persistentId !== 'P'))
    await act(() => result.current.apply())
    expect(result.current.duplicates.map((d) => d.group.key)).toContain(second)
  })

  it('skips a duplicate group whose chosen copy is not a member', async () => {
    const api = setApi({ loadMusicReview: vi.fn().mockResolvedValue(DUPS) })
    const { result } = await ready()
    const key = result.current.duplicates[0].group.key
    act(() => result.current.choose(key, 'ZZZ'))
    act(() => result.current.toggleStaged(key))
    expect(result.current.summary.duplicates).toBe(0)
    await act(() => result.current.apply())
    expect(api.removeMusicDuplicate).not.toHaveBeenCalled()
  })

  it('unstages a duplicate or version group that shares a track with the one staged', async () => {
    const lib = [
      e('P', 'Ann', { title: 'Song', durationSec: 100 }),
      e('Q', 'Ann', { title: 'Song', durationSec: 101 }),
      e('R', 'Ann', { title: 'Song', durationSec: 300 }),
    ]
    setApi({ loadMusicReview: vi.fn().mockResolvedValue(lib) })
    const { result } = await ready()
    const dup = result.current.duplicates.find((d) => d.group.kind === 'duplicate')?.group
      .key as string
    const ver = result.current.duplicates.find((d) => d.group.kind === 'version')?.group
      .key as string
    act(() => result.current.toggleStaged(dup))
    act(() => result.current.toggleStaged(ver))
    expect([...result.current.staged]).toEqual([ver])
  })

  // The detail shows the writes before they are staged, so it must match what apply sends.
  it('previews the tracks and fields the chosen spelling would change', async () => {
    setApi({
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([
          e('A', 'DJ Lara', { albumArtist: 'DJ Lara' }),
          e('B', 'DJ Lara', { albumArtist: 'DJ Lara' }),
          e('C', 'Dj Lara', { albumArtist: 'Dj Lara' }),
        ]),
    })
    const { result } = await ready()
    const key = result.current.spelling[0].key
    expect(result.current.affected(key)).toEqual([
      { persistentId: 'C', title: 'TC', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
      { persistentId: 'C', title: 'TC', field: 'albumArtist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    act(() => result.current.choose(key, 'Dj Lara'))
    expect(result.current.affected(key).map((f) => f.persistentId)).toEqual(['A', 'B', 'A', 'B'])
  })

  it('previews nothing while the group is tied', async () => {
    setApi({
      loadMusicReview: vi
        .fn()
        .mockResolvedValue([e('A', 'Rachel Auburn'), e('B', 'Rahcel Auburn')]),
    })
    const { result } = await ready()
    expect(result.current.affected(result.current.spelling[0].key)).toEqual([])
  })

  it('keeps the full path of each copy for the detail', async () => {
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue(DUPS),
      appleMusicEntryLocation: vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => (pid === 'Q' ? '/m/Ann/q.flac' : '')),
    })
    const { result } = await ready()
    await waitFor(() =>
      expect(result.current.duplicates[0].locations).toEqual({ P: '', Q: '/m/Ann/q.flac' }),
    )
  })

  // A copy Music lists without a file is the one to lose: keeping it would leave the
  // library with no audio for the track.
  it('never suggests keeping a copy without a file while another has one', async () => {
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue(DUPS),
      appleMusicEntryLocation: vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => (pid === 'Q' ? '/m/q.mp3' : '')),
    })
    const { result } = await ready()
    await waitFor(() => expect(result.current.duplicates[0].locations).toHaveProperty('Q'))
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('Q')
  })

  it('suggests the first copy when none has a file', async () => {
    setApi({
      loadMusicReview: vi.fn().mockResolvedValue(DUPS),
      appleMusicEntryLocation: vi.fn<Api['appleMusicEntryLocation']>().mockResolvedValue(''),
    })
    const { result } = await ready()
    await waitFor(() => expect(result.current.duplicates[0].locations).toHaveProperty('Q'))
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('P')
  })

  // A lookup that failed says nothing about the file; reading it as "no file" would steer
  // the user into removing the copy that still has the audio.
  describe('a location lookup that fails', () => {
    it('retries once and then leaves the copy unknown and the group unstageable', async () => {
      const appleMusicEntryLocation = vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => {
          if (pid === 'P') throw new Error('AppleScript')
          return '/m/q.flac'
        })
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(DUPS), appleMusicEntryLocation })
      const { result } = await ready()
      await waitFor(() =>
        expect(appleMusicEntryLocation.mock.calls.filter(([pid]) => pid === 'P')).toHaveLength(2),
      )
      await act(async () => {})
      expect(appleMusicEntryLocation.mock.calls.filter(([pid]) => pid === 'P')).toHaveLength(2)
      const [card] = result.current.duplicates
      expect(card.locations).toEqual({ Q: '/m/q.flac' })
      act(() => result.current.toggleStaged(card.group.key))
      expect(result.current.staged.size).toBe(0)
    })

    it('uses the retry when it succeeds', async () => {
      let failed = false
      const appleMusicEntryLocation = vi
        .fn<Api['appleMusicEntryLocation']>()
        .mockImplementation(async (pid) => {
          if (pid === 'P' && !failed) {
            failed = true
            throw new Error('AppleScript')
          }
          return pid === 'P' ? '' : '/m/q.flac'
        })
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(DUPS), appleMusicEntryLocation })
      const { result } = await ready()
      await waitFor(() =>
        expect(result.current.duplicates[0].locations).toEqual({ P: '', Q: '/m/q.flac' }),
      )
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      expect(result.current.staged.size).toBe(1)
    })
  })

  describe('one group per name across artist and album artist', () => {
    const BOTH = [
      e('A', 'DJ Lara', { albumArtist: 'DJ Lara' }),
      e('B', 'DJ Lara', { albumArtist: 'DJ Lara' }),
      e('C', 'Dj Lara', { albumArtist: 'Dj Lara' }),
      e('D', 'DJ Lara'),
    ]

    // The same misspelling credited as artist and as album artist is one decision for the
    // user; showing it twice made them fix the same name twice.
    it('merges both fields into one group counting each track once', async () => {
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(BOTH) })
      const { result } = await ready()
      expect(result.current.spelling).toHaveLength(1)
      const [g] = result.current.spelling
      expect(g.fields).toEqual(['artist', 'albumArtist'])
      expect(g.variants).toEqual([
        { value: 'DJ Lara', persistentIds: ['A', 'B', 'D'] },
        { value: 'Dj Lara', persistentIds: ['C'] },
      ])
      expect(g.parts).toHaveLength(2)
      expect(g.key).toBe(
        g.parts
          .map((p) => p.key)
          .sort()
          .join('+'),
      )
      expect(result.current.choice(g.key)).toBe('DJ Lara')
    })

    it('fixes both fields when the merged group is staged', async () => {
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(BOTH) })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      expect(result.current.summary).toMatchObject({
        tracks: 1,
        byField: { artist: 1, albumArtist: 1 },
      })
    })

    it('applies the chosen spelling to both fields', async () => {
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(BOTH) })
      const { result } = await ready()
      const key = result.current.spelling[0].key
      act(() => result.current.choose(key, 'Dj Lara'))
      act(() => result.current.toggleStaged(key))
      expect(result.current.summary).toMatchObject({
        tracks: 3,
        byField: { artist: 3, albumArtist: 2 },
      })
    })

    // Ignores are stored per field so a list saved before the merge still hides its groups.
    it('saves every part key when the merged group is ignored', async () => {
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(BOTH) })
      const saveIgnored = vi.fn()
      const { result } = await ready({ saveIgnored })
      const [g] = result.current.spelling
      act(() => result.current.toggleStaged(g.key))
      act(() => result.current.ignore(g.key))
      expect(saveIgnored).toHaveBeenCalledWith(g.parts.map((p) => p.key))
      expect(result.current.spelling).toEqual([])
      expect(result.current.staged.size).toBe(0)
    })

    it('keeps a group found only in album artist on its own', async () => {
      setApi({
        loadMusicReview: vi
          .fn()
          .mockResolvedValue([
            e('A', 'Ann', { albumArtist: 'DJ Lara' }),
            e('B', 'Bob', { albumArtist: 'Dj Lara' }),
          ]),
      })
      const { result } = await ready()
      expect(result.current.spelling.map((g) => g.fields)).toEqual([['albumArtist']])
    })

    it('still hides the other field when only one part was ignored before', async () => {
      setApi({ loadMusicReview: vi.fn().mockResolvedValue(BOTH) })
      const first = await ready()
      const artistKey = first.result.current.spelling[0].parts.find((p) => p.field === 'artist')
        ?.key as string
      first.unmount()
      const { result } = await ready({ ignored: [artistKey] })
      expect(result.current.spelling.map((g) => g.fields)).toEqual([['albumArtist']])
    })

    // The parts can lean different ways; the union decides, never one field alone.
    it('suggests from the union when the parts disagree', async () => {
      setApi({
        loadMusicReview: vi
          .fn()
          .mockResolvedValue([
            e('A', 'DJ Lara', { albumArtist: 'DJ Lara' }),
            e('B', 'DJ Lara'),
            e('C', 'Dj Lara'),
            e('D', 'Ann', { albumArtist: 'Dj Lara' }),
            e('E', 'Ann', { albumArtist: 'Dj Lara' }),
            e('F', 'Ann', { albumArtist: 'Dj Lara' }),
          ]),
      })
      const { result } = await ready()
      const [g] = result.current.spelling
      expect(g.parts.map((p) => p.suggested)).toEqual(['DJ Lara', 'Dj Lara'])
      expect(result.current.choice(g.key)).toBe('Dj Lara')
    })
  })
})
