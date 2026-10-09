// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { MusicReviewEntry, RemoveCopyResult } from '../../../shared/types'
import { trackSignature } from '../lib/dirty'
import { listReviewSource } from '../lib/listReviewSource'
import type { TrackItem } from '../types'
import { type MusicReview, useMusicReview } from './useMusicReview'

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
const SYNCED = {
  rekordbox: { outcome: 'updated' as const, count: 1 },
  engine: { outcome: 'nothing' as const },
  traktor: { outcome: 'missing' as const },
}
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
    syncLibraryTags: vi.fn<Api['syncLibraryTags']>().mockResolvedValue(SYNCED),
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
    libraryStatus: vi.fn<Api['libraryStatus']>().mockResolvedValue({
      rekordbox: { enabled: true, found: false },
      engine: { enabled: false, found: false },
      traktor: { enabled: false, found: false },
    }),
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

const reduceMotion = (reduce: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as never
}

// The bar's fill is waited out only with motion on; most runs here skip it to stay fast.
beforeEach(() => reduceMotion(true))
afterEach(() => vi.restoreAllMocks())

describe('useMusicReview', () => {
  it('exposes which libraries are on and found so the review can be honest about them', async () => {
    setApi()
    const { result } = await ready()
    await waitFor(() =>
      expect(result.current.libraries?.rekordbox).toEqual({ enabled: true, found: false }),
    )
  })

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
    expect(api.trashRestore).toHaveBeenCalledWith('b1', 'undo')
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

  describe('feedback while a run goes', () => {
    const gate = <T,>() => {
      let open: (v: T) => void = () => {}
      const promise = new Promise<T>((resolve) => {
        open = resolve
      })
      return { promise, open }
    }

    const recording = async (over = {}) => {
      const states: (Pick<MusicReview, 'status' | 'progress'> & { at: number })[] = []
      const hook = renderHook(() => {
        const r = useMusicReview(props(over))
        states.push({ status: r.status, progress: r.progress, at: performance.now() })
        return r
      })
      await waitFor(() => expect(hook.result.current.status).toBe('ready'))
      return { ...hook, states }
    }

    // The first event from main can take a moment; the total is known the instant the user
    // confirms, so the run shows itself from the click.
    it('sets the progress and the writing phase the moment apply starts', async () => {
      setApi({ applyMusicFixes: vi.fn().mockReturnValue(new Promise(() => {})) })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      act(() => {
        void result.current.apply()
      })
      expect(result.current.progress).toEqual({ done: 0, total: 1 })
      expect(result.current.phase).toEqual({ name: 'writing', current: 1, total: 1 })
    })

    it('follows main as each track starts and finishes', async () => {
      let send: (p: { done: number; total: number; current: number }) => void = () => {}
      setApi({
        applyMusicFixes: vi.fn().mockReturnValue(new Promise(() => {})),
        onMusicFixProgress: vi.fn().mockImplementation((cb) => {
          send = cb
          return () => {}
        }),
      })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      act(() => {
        void result.current.apply()
      })
      act(() => send({ done: 1, total: 1, current: 1 }))
      expect(result.current.progress).toEqual({ done: 1, total: 1 })
      expect(result.current.phase).toEqual({ name: 'writing', current: 1, total: 1 })
    })

    it('names each step of an apply in order and fills the bar before the result', async () => {
      reduceMotion(false)
      const write = gate<never[]>()
      const remove = gate<RemoveCopyResult>()
      const replace = gate<never[]>()
      const reread = gate<typeof LIB>()
      const load = vi
        .fn()
        .mockResolvedValueOnce([...LIB, ...DUPS])
        .mockReturnValueOnce(reread.promise)
      setApi({
        loadMusicReview: load,
        applyMusicFixes: vi.fn().mockReturnValue(write.promise),
        removeMusicDuplicate: vi.fn().mockReturnValue(remove.promise),
        replaceDuplicatesInLibraries: vi.fn().mockReturnValue(replace.promise),
      })
      const { result, states } = await recording()
      await waitFor(() => expect(result.current.duplicates[0].formats.P).toBe('AIFF'))
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      let run: Promise<void> = Promise.resolve()
      act(() => {
        run = result.current.apply()
      })
      expect(result.current.progress).toEqual({ done: 0, total: 2 })
      expect(result.current.phase?.name).toBe('writing')
      write.open([])
      await waitFor(() =>
        expect(result.current.phase).toEqual({ name: 'duplicates', current: 1, total: 1 }),
      )
      remove.open({
        outcome: 'removed',
        playlists: 0,
        fileTrashed: true,
        pair: { from: '/a', to: '/b', shared: false },
      })
      await waitFor(() => expect(result.current.phase).toEqual({ name: 'libraries' }))
      replace.open([])
      await waitFor(() => expect(result.current.phase).toEqual({ name: 'verifying' }))
      reread.open(LIB)
      await act(() => run)
      const full = states.find((x) => x.status === 'applying' && x.progress?.done === 2)
      const shown = states.find((x) => x.status === 'done')
      expect(full?.progress).toEqual({ done: 2, total: 2 })
      expect((shown?.at ?? 0) - (full?.at ?? 0)).toBeGreaterThanOrEqual(250)
      expect(result.current.status).toBe('done')
      expect(result.current.progress).toBeNull()
      expect(result.current.phase).toBeNull()
    })

    // A stopped run did not finish; a full bar would say it had.
    it('does not fill the bar when the run was stopped', async () => {
      reduceMotion(false)
      const write = gate<never[]>()
      setApi({ applyMusicFixes: vi.fn().mockReturnValue(write.promise) })
      const { result, states } = await recording()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      let run: Promise<void> = Promise.resolve()
      act(() => {
        run = result.current.apply()
      })
      act(() => result.current.cancel())
      write.open([])
      await waitFor(() => expect(result.current.status).toBe('done'))
      await act(() => run)
      expect(
        states.some((x) => x.status === 'applying' && x.progress?.done === x.progress?.total),
      ).toBe(false)
    })

    it('names the restore and the steps after it when undoing', async () => {
      const restore = gate<{ restoredTo: string }>()
      const sync = gate<undefined>()
      setApi({
        trashRestore: vi.fn().mockReturnValue(restore.promise),
        syncLibraryTags: vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(sync.promise),
      })
      const { result } = await recording()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      await act(() => result.current.apply())
      let run: Promise<void> = Promise.resolve()
      act(() => {
        run = result.current.undo()
      })
      expect(result.current.phase).toEqual({ name: 'restoring', current: 1, total: 1 })
      restore.open({ restoredTo: '/m/c.mp3' })
      await waitFor(() => expect(result.current.phase).toEqual({ name: 'libraries' }))
      sync.open(undefined)
      await act(() => run)
      expect(result.current.phase).toBeNull()
    })
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

    it('does not claim the libraries were untouched when stopped during their call', async () => {
      let finishReplace: (v: never) => void = () => {}
      const api = setApi({
        loadMusicReview: vi.fn().mockResolvedValue(THREE),
        removeMusicDuplicate: vi.fn().mockResolvedValue(removedWith('/m/q.aiff')),
        replaceDuplicatesInLibraries: vi
          .fn()
          .mockReturnValue(new Promise((r) => (finishReplace = r))),
      })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
      let run: Promise<void> = Promise.resolve()
      act(() => {
        run = result.current.apply()
      })
      await waitFor(() => expect(api.replaceDuplicatesInLibraries).toHaveBeenCalled())
      act(() => result.current.cancel())
      const outcomes = [{ from: '/m/q.aiff', fileTrashed: false, keptForLibrary: false }]
      await act(async () => {
        finishReplace(outcomes as never)
        await run
      })
      expect(result.current.lastRun?.librariesUntouched).toBeUndefined()
      expect(result.current.lastRun?.replaced).toEqual(outcomes)
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
    expect(result.current.lastRun?.outcomes.map((o) => o.id)).toEqual(['C'])
    expect(result.current.status).toBe('ready')
  })

  it('forgets the removals and library lines when a failed undo leaves the run to retry', async () => {
    const replaced = [{ from: '/m/q.aiff', fileTrashed: false, keptForLibrary: false }]
    setApi({
      applyMusicFixes: vi.fn().mockResolvedValue(twoOutcomes),
      loadMusicReview: vi.fn().mockResolvedValue([...LIB, ...DUPS]),
      trashRestore: vi.fn().mockRejectedValue(new Error('no such trash entry')),
      replaceDuplicatesInLibraries: vi.fn().mockResolvedValue(replaced),
      removeMusicDuplicate: vi.fn().mockResolvedValue({
        outcome: 'removed',
        playlists: 0,
        fileTrashed: false,
        pair: { from: '/m/q.aiff', to: '/m/p.aiff', shared: false },
      }),
    })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(result.current.lastRun?.removed).toHaveLength(1)
    await act(() => result.current.undo())
    expect(result.current.lastRun).toMatchObject({ undoFailures: 2, removed: [], replaced: [] })
  })

  it('says it is undoing only while an undo runs', async () => {
    const restore = (() => {
      let open: () => void = () => {}
      const promise = new Promise<{ restoredTo: string }>(
        (r) => (open = () => r({ restoredTo: '/m/c.mp3' })),
      )
      return { promise, open }
    })()
    const { result } = await runTwo({ trashRestore: vi.fn().mockReturnValue(restore.promise) })
    expect(result.current.undoing).toBe(false)
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.undo()
    })
    expect(result.current.undoing).toBe(true)
    restore.open()
    await act(() => run)
    expect(result.current.undoing).toBe(false)
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
    expect(result.current.lastRun?.outcomes.map((o) => o.id)).toEqual(['C'])
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

  // Each field answers for itself: the one Music took back follows into the libraries, and
  // a retry asks again only for the one it refused.
  it('undoes field by field and retries only the field Music refused', async () => {
    const both = {
      persistentId: 'C',
      path: '/m/c.mp3',
      fixes: [
        { persistentId: 'C', field: 'artist' as const, from: 'Dj Lara', to: 'DJ Lara' },
        { persistentId: 'C', field: 'albumArtist' as const, from: 'Dj Lara', to: 'DJ Lara' },
      ],
      music: ['set' as const, 'set' as const],
      file: 'written' as const,
      written: ['artist' as const, 'albumArtist' as const],
      backupId: 'b1',
    }
    const setMusicField = vi
      .fn<Api['setMusicField']>()
      .mockResolvedValueOnce('set')
      .mockResolvedValueOnce('mismatch')
      .mockResolvedValue('set')
    const api = setApi({ applyMusicFixes: vi.fn().mockResolvedValue([both]), setMusicField })
    const { result } = await ready()
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/c.mp3', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
    expect(result.current.lastRun).toMatchObject({ undoFailures: 1 })
    await act(() => result.current.undo())
    expect(setMusicField).toHaveBeenCalledTimes(3)
    expect(api.trashRestore).toHaveBeenCalledTimes(1)
    expect(setMusicField).toHaveBeenLastCalledWith('C', 'albumArtist', 'DJ Lara', 'Dj Lara')
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/c.mp3', fields: { albumArtist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
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

  describe('a track corrected in Music but not in its file', () => {
    const musicOnly = {
      persistentId: 'C',
      path: '/m/c.wav',
      fixes: [{ persistentId: 'C', field: 'album' as const, from: 'Ultra ', to: 'Ultra' }],
      music: ['set' as const],
      file: 'unchanged' as const,
      written: [],
    }

    it('still hands the change to the DJ libraries, but reports no file changed', async () => {
      const api = setApi({ applyMusicFixes: vi.fn().mockResolvedValue([musicOnly]) })
      const onFilesChanged = vi.fn()
      const { result } = await ready({ onFilesChanged })
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      await act(() => result.current.apply())
      expect(api.syncLibraryTags).toHaveBeenCalledWith([
        { path: '/m/c.wav', fields: { album: { from: 'Ultra ', to: 'Ultra' } } },
      ])
      expect(onFilesChanged).not.toHaveBeenCalled()
      expect(result.current.lastRun?.librarySync).toBe('ok')
      expect(result.current.lastRun?.tagSync).toEqual(SYNCED)
    })

    it('sends the libraries nothing when Music refused the change', async () => {
      const api = setApi({
        applyMusicFixes: vi
          .fn()
          .mockResolvedValue([
            { ...musicOnly, music: ['mismatch'], file: 'skipped', path: undefined },
          ]),
      })
      const { result } = await ready()
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      await act(() => result.current.apply())
      expect(api.syncLibraryTags).not.toHaveBeenCalled()
      expect(result.current.lastRun?.librarySync).toBe('none')
      expect(result.current.lastRun?.tagSync).toBeUndefined()
    })

    it('puts the libraries back on undo along with Music', async () => {
      const api = setApi({ applyMusicFixes: vi.fn().mockResolvedValue([musicOnly]) })
      const onFilesChanged = vi.fn()
      const { result } = await ready({ onFilesChanged })
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      await act(() => result.current.apply())
      await act(() => result.current.undo())
      expect(api.trashRestore).not.toHaveBeenCalled()
      expect(api.setMusicField).toHaveBeenCalledWith('C', 'album', 'Ultra', 'Ultra ')
      expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
        { path: '/m/c.wav', fields: { album: { from: 'Ultra', to: 'Ultra ' } } },
      ])
      expect(onFilesChanged).not.toHaveBeenCalled()
    })
  })

  it('records a failed library sync', async () => {
    const { result } = await runTwo({ syncLibraryTags: vi.fn().mockRejectedValue(new Error('x')) })
    expect(result.current.lastRun?.librarySync).toBe('failed')
  })

  // A library that failed or was open on undo is the one still holding the new value.
  it('keeps what each library did on an undo that left something behind', async () => {
    const syncLibraryTags = vi
      .fn<Api['syncLibraryTags']>()
      .mockResolvedValueOnce(SYNCED)
      .mockResolvedValue({ ...SYNCED, rekordbox: { outcome: 'failed' } })
    const trashRestore = vi
      .fn<Api['trashRestore']>()
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue({ restoredTo: '/m/d.mp3' })
    const { result } = await runTwo({ syncLibraryTags, trashRestore })
    await act(() => result.current.undo())
    expect(result.current.lastRun?.tagSync).toEqual({ ...SYNCED, rekordbox: { outcome: 'failed' } })
  })

  it('keeps the sheet when a library could not be put back though every file was', async () => {
    const syncLibraryTags = vi
      .fn<Api['syncLibraryTags']>()
      .mockResolvedValueOnce(SYNCED)
      .mockResolvedValue({
        ...SYNCED,
        traktor: { outcome: 'nothing' },
        engine: { outcome: 'open' },
      })
    const { result } = await runTwo({ syncLibraryTags })
    await act(() => result.current.undo())
    expect(result.current.lastRun).toMatchObject({
      undoFailures: 0,
      tagSync: { engine: { outcome: 'open' } },
    })
  })

  // Closing the open library and pressing Undo again is the only way left to put it back:
  // the files and Music are already back, so the retry owes only the libraries.
  it('sends a library left open on undo its change again on the next undo', async () => {
    const syncLibraryTags = vi
      .fn<Api['syncLibraryTags']>()
      .mockResolvedValueOnce(SYNCED)
      .mockResolvedValueOnce({ ...SYNCED, engine: { outcome: 'open' } })
      .mockResolvedValue(SYNCED)
    const { api, result } = await runTwo({ syncLibraryTags })
    await act(() => result.current.undo())
    const sent = syncLibraryTags.mock.calls[1][0]
    expect(result.current.lastRun?.libraryUndo).toEqual(sent)
    await act(() => result.current.undo())
    expect(syncLibraryTags).toHaveBeenCalledTimes(3)
    expect(syncLibraryTags).toHaveBeenLastCalledWith(sent)
    expect(api.trashRestore).toHaveBeenCalledTimes(2)
    expect(result.current.lastRun).toBeNull()
  })

  it('closes the sheet when the undo reached every library it touched', async () => {
    const syncLibraryTags = vi
      .fn<Api['syncLibraryTags']>()
      .mockResolvedValueOnce(SYNCED)
      .mockResolvedValue({ ...SYNCED, traktor: { outcome: 'missing' } })
    const { result } = await runTwo({ syncLibraryTags })
    await act(() => result.current.undo())
    expect(result.current.lastRun).toBeNull()
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
      { id: 'C', title: 'TC', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
      { id: 'C', title: 'TC', field: 'albumArtist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    act(() => result.current.choose(key, 'Dj Lara'))
    expect(result.current.affected(key).map((f) => f.id)).toEqual(['A', 'B', 'A', 'B'])
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

  describe('keeping a copy without a file', () => {
    const noFileOnP = () =>
      setApi({
        loadMusicReview: vi.fn().mockResolvedValue(DUPS),
        appleMusicEntryLocation: vi
          .fn<Api['appleMusicEntryLocation']>()
          .mockImplementation(async (pid) => (pid === 'Q' ? '/m/q.mp3' : '')),
      })

    it('keeps the copy with a file when the one without is chosen', async () => {
      const api = noFileOnP()
      const { result } = await ready()
      await waitFor(() => expect(result.current.duplicates[0].locations).toHaveProperty('Q'))
      const key = result.current.duplicates[0].group.key
      act(() => result.current.choose(key, 'P'))
      act(() => result.current.toggleStaged(key))
      expect(result.current.choice(key)).toBe('Q')
      await act(() => result.current.apply())
      expect(api.removeMusicDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ removePid: 'P', keepPid: 'Q' }),
      )
    })

    it('falls back to the suggested copy when a copy picked early turns out to have no file', async () => {
      let resolve: () => void = () => {}
      const lookup = new Promise<void>((r) => (resolve = r))
      const api = setApi({
        loadMusicReview: vi.fn().mockResolvedValue(DUPS),
        appleMusicEntryLocation: vi
          .fn<Api['appleMusicEntryLocation']>()
          .mockImplementation(async (pid) => {
            await lookup
            return pid === 'Q' ? '/m/q.mp3' : ''
          }),
      })
      const { result } = await ready()
      const key = result.current.duplicates[0].group.key
      act(() => result.current.choose(key, 'P'))
      expect(result.current.choice(key)).toBe('P')
      resolve()
      await waitFor(() => expect(result.current.duplicates[0].locations).toHaveProperty('Q'))
      expect(result.current.choice(key)).toBe('Q')
      act(() => result.current.toggleStaged(key))
      await act(() => result.current.apply())
      expect(api.removeMusicDuplicate).toHaveBeenCalledWith(
        expect.objectContaining({ removePid: 'P', keepPid: 'Q' }),
      )
    })
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
        { value: 'DJ Lara', ids: ['A', 'B', 'D'] },
        { value: 'Dj Lara', ids: ['C'] },
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

    // The user saw "Aarón Alfonso" twice, once per field, for one invisible character.
    it('merges an invisible character found in both fields into one group', async () => {
      const dirty = 'Aar\u200Bón Alfonso'
      setApi({
        loadMusicReview: vi
          .fn()
          .mockResolvedValue([
            e('A', dirty, { albumArtist: dirty }),
            e('B', dirty, { albumArtist: dirty }),
          ]),
      })
      const { result } = await ready()
      expect(result.current.spelling.map((g) => [g.kind, g.fields])).toEqual([
        ['invisible', ['artist', 'albumArtist']],
      ])
    })

    it('merges the two fields when they share a spelling but one has more of them', async () => {
      const dirty = 'Aar\u200Bón Alfonso'
      setApi({
        loadMusicReview: vi
          .fn()
          .mockResolvedValue([
            e('A', dirty, { albumArtist: dirty }),
            e('B', 'Aarón Alfonso'),
            e('C', 'Aarón Alfonso'),
          ]),
      })
      const { result } = await ready()
      expect(result.current.spelling.map((g) => [g.kind, g.fields])).toEqual([
        ['invisible', ['artist', 'albumArtist']],
      ])
      expect(result.current.choice(result.current.spelling[0].key)).toBe('Aarón Alfonso')
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

  // The seam the list review plugs into: a source given to the hook is the only thing it
  // talks to for reading, writing and undoing.
  it('reads, writes and undoes through the source it is given', async () => {
    setApi()
    const source = {
      kind: 'music' as const,
      load: vi.fn().mockResolvedValue({
        entries: [
          { id: '/a', title: 'A', artist: 'DJ Lara', albumArtist: '', album: '', genre: '' },
          { id: '/b', title: 'B', artist: 'DJ Lara', albumArtist: '', album: '', genre: '' },
          { id: '/c', title: 'C', artist: 'Dj Lara', albumArtist: '', album: '', genre: '' },
        ],
        skipped: 0,
      }),
      locate: vi.fn(async (id: string) => id),
      applyFixes: vi.fn().mockResolvedValue([
        {
          id: '/c',
          musicId: 'PID',
          path: '/c',
          fixes: [{ id: '/c', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }],
          music: ['set'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]),
      onProgress: vi.fn(() => () => {}),
      cancel: vi.fn(),
      removeCopies: vi.fn(),
      revertMusic: vi.fn().mockResolvedValue('set'),
    }
    const { result } = renderHook(() => useMusicReview(props({ source })))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(source.applyFixes).toHaveBeenCalledWith([
      { id: '/c', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' },
    ])
    await act(() => result.current.undo())
    expect(source.revertMusic).toHaveBeenCalledWith(expect.objectContaining({ musicId: 'PID' }), {
      id: '/c',
      field: 'artist',
      from: 'Dj Lara',
      to: 'DJ Lara',
    })
    expect(window.api.loadMusicReview).not.toHaveBeenCalled()
  })
})

describe('with the list as source', () => {
  const row = (path: string, artist: string, title = 'Song', over: Partial<TrackItem> = {}) => {
    const meta = { ...emptyMetadata(), title, artist }
    return {
      id: path,
      inputPath: path,
      fileName: path,
      listLabel: title,
      query: '',
      status: 'idle',
      meta,
      diskSignature: trackSignature({ meta }),
      ...over,
    } as TrackItem
  }
  const LARA = [
    row('/m/a.aiff', 'DJ Lara', 'Ta'),
    row('/m/b.aiff', 'DJ Lara', 'Tb'),
    row('/m/c.aiff', 'Dj Lara', 'Tc'),
  ]
  const FIX = { id: '/m/c.aiff', field: 'artist', from: 'Dj Lara', to: 'DJ Lara' }
  const listApi = (over = {}) =>
    setApi({
      appleMusicFileEntries: vi.fn().mockResolvedValue({
        consulted: true,
        entries: { '/m/c.aiff': [{ persistentId: 'PID', label: 'Dj Lara - Tc' }] },
      }),
      applyListFixes: vi.fn().mockResolvedValue([
        {
          id: '/m/c.aiff',
          musicId: 'PID',
          path: '/m/c.aiff',
          fixes: [FIX],
          music: ['set'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]),
      onListFixProgress: vi.fn(() => () => {}),
      cancelListFixes: vi.fn().mockResolvedValue(undefined),
      removeListDuplicates: vi
        .fn()
        .mockResolvedValue([{ from: '/m/b.aiff', fileTrashed: true, keptForLibrary: false }]),
      onListRemovalPhase: vi.fn(() => () => {}),
      ...over,
    })
  const listHook = (rows: TrackItem[], onRowsRemoved = vi.fn(), over = {}) => {
    const source = listReviewSource({
      rows: () => rows,
      mac: true,
      launchMusic: () => true,
      onRowsRemoved,
    })
    return renderHook(() => useMusicReview(props({ source, ...over })))
  }
  const ANN = [row('/m/a.aiff', 'Ann'), row('/m/b.aiff', 'Ann')]
  const located = async (result: { current: MusicReview }) =>
    waitFor(() =>
      expect(result.current.duplicates[0]?.locations).toEqual({
        '/m/a.aiff': '/m/a.aiff',
        '/m/b.aiff': '/m/b.aiff',
      }),
    )

  it('writes the file, follows the libraries and recounts without the fixed group', async () => {
    const api = listApi()
    const onRowsRemoved = vi.fn()
    const { result } = listHook(LARA, onRowsRemoved)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.kind).toBe('list')
    expect(result.current.inMusic('/m/c.aiff')).toBe(true)
    expect(result.current.inMusic('/m/a.aiff')).toBe(false)
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(api.applyListFixes).toHaveBeenCalledWith({
      fixes: [FIX],
      music: { '/m/c.aiff': 'PID' },
      titles: { '/m/c.aiff': 'Tc' },
    })
    expect(api.syncLibraryTags).toHaveBeenCalledWith([
      { path: '/m/c.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
    expect(api.loadMusicReview).not.toHaveBeenCalled()
    expect(onRowsRemoved).not.toHaveBeenCalled()
    expect(result.current.spelling).toEqual([])
    expect(result.current.lastRun).toMatchObject({ before: 1, after: 0 })
  })

  // Most list tracks are not in Music: the libraries follow the file there, or the fix
  // stops at the file and rekordbox keeps the old spelling.
  it('sends a fix the file took to the libraries when Music does not hold the track', async () => {
    const api = listApi({
      applyListFixes: vi.fn().mockResolvedValue([
        {
          id: '/m/c.aiff',
          path: '/m/c.aiff',
          fixes: [FIX],
          music: ['none'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]),
    })
    const { result } = listHook(LARA)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(api.syncLibraryTags).toHaveBeenCalledWith([
      { path: '/m/c.aiff', fields: { artist: { from: 'Dj Lara', to: 'DJ Lara' } } },
    ])
  })

  // A title or artist the list took from the file name is not in the file, so main's guard
  // leaves it: the run must not count it as fixed nor tell the list or the libraries it was.
  it('counts a fix main left unchanged as not touched', async () => {
    const api = listApi({
      applyListFixes: vi
        .fn()
        .mockResolvedValue([
          { id: '/m/c.aiff', fixes: [FIX], music: ['none'], file: 'unchanged', written: [] },
        ]),
    })
    const onFilesChanged = vi.fn()
    const { result } = listHook(LARA, vi.fn(), { onFilesChanged })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(api.syncLibraryTags).not.toHaveBeenCalled()
    expect(onFilesChanged).not.toHaveBeenCalled()
    expect(result.current.spelling).toHaveLength(1)
    expect(result.current.lastRun).toMatchObject({ before: 1, after: 1 })
    expect(result.current.lastRun?.outcomes.map((o) => o.file)).toEqual(['unchanged'])
  })

  it('says how many rows it reviewed, how many it left out and whether Music answered', async () => {
    listApi({
      appleMusicFileEntries: vi.fn().mockResolvedValue({ consulted: false, entries: {} }),
    })
    const { result } = listHook([...LARA, row('/m/d.aiff', 'X', 'Td', { metaReadFailed: true })])
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current).toMatchObject({ reviewed: 3, skipped: 1, musicConsulted: false })
    expect(result.current.inMusic('/m/c.aiff')).toBe(false)
  })

  // The cards stop showing Music once a reload fails; the scope line must not still say it
  // was asked.
  it('says Music went unasked once a reload after applying fails', async () => {
    listApi({
      appleMusicFileEntries: vi
        .fn()
        .mockResolvedValueOnce({ consulted: true, entries: {} })
        .mockRejectedValueOnce(new Error('ipc')),
    })
    const { result } = listHook([...LARA, row('/m/d.aiff', 'DJ Lara', 'Tc')])
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.musicConsulted).toBe(true)
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(result.current.lastRun?.after).toBeNull()
    expect(result.current.musicConsulted).toBe(false)
  })

  it('locates each copy at its own path and takes the trashed copy out of the list', async () => {
    const api = listApi()
    const onRowsRemoved = vi.fn()
    const { result } = listHook(ANN, onRowsRemoved)
    await located(result)
    expect(result.current.duplicates[0].formats).toEqual({
      '/m/a.aiff': 'AIFF',
      '/m/b.aiff': 'AIFF',
    })
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(api.removeListDuplicates).toHaveBeenCalledWith([
      { from: '/m/b.aiff', to: '/m/a.aiff', label: 'Ann - Song' },
    ])
    expect(onRowsRemoved).toHaveBeenCalledWith(['/m/b.aiff'])
    expect(result.current.duplicates).toEqual([])
    expect(result.current.lastRun).toMatchObject({
      removed: [],
      replaced: [{ from: '/m/b.aiff', fileTrashed: true }],
    })
  })

  // A copy Music or a DJ library still holds stays on disk, so it stays in the list too.
  it('keeps a copy whose file stayed on disk', async () => {
    listApi({
      removeListDuplicates: vi.fn().mockResolvedValue([
        {
          from: '/m/b.aiff',
          fileTrashed: false,
          keptForLibrary: false,
          keptForMusic: true,
          music: 'held',
        },
      ]),
    })
    const onRowsRemoved = vi.fn()
    const { result } = listHook(ANN, onRowsRemoved)
    await located(result)
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    await act(() => result.current.apply())
    expect(onRowsRemoved).not.toHaveBeenCalled()
    expect(result.current.duplicates).toHaveLength(1)
    expect(result.current.lastRun?.replaced).toEqual([
      expect.objectContaining({ keptForMusic: true, music: 'held' }),
    ])
  })

  it('shows that main is checking Music while it removes', async () => {
    let phase: (p: 'checking-music') => void = () => {}
    let finish: (v: unknown[]) => void = () => {}
    listApi({
      onListRemovalPhase: vi.fn((cb: (p: 'checking-music') => void) => {
        phase = cb
        return () => {}
      }),
      removeListDuplicates: vi.fn(() => new Promise((r) => (finish = r))),
    })
    const { result } = listHook(ANN)
    await located(result)
    act(() => result.current.toggleStaged(result.current.duplicates[0].group.key))
    let run: Promise<void> = Promise.resolve()
    act(() => {
      run = result.current.apply()
    })
    await waitFor(() => expect(result.current.phase).toMatchObject({ name: 'duplicates' }))
    act(() => phase('checking-music'))
    expect(result.current.phase).toEqual({ name: 'checking-music' })
    await act(async () => {
      finish([])
      await run
    })
    expect(result.current.status).toBe('done')
  })

  it('stops the writes in main and removes nothing once the user stops the run', async () => {
    let finish: (v: never[]) => void = () => {}
    const api = listApi({
      applyListFixes: vi.fn().mockReturnValue(new Promise<never[]>((r) => (finish = r))),
    })
    const { result } = listHook([
      ...LARA,
      ...ANN.map((r) => ({
        ...r,
        inputPath: r.inputPath.replace('/m/', '/n/'),
        id: r.inputPath.replace('/m/', '/n/'),
      })),
    ])
    await waitFor(() =>
      expect(result.current.duplicates[0]?.locations).toEqual({
        '/n/a.aiff': '/n/a.aiff',
        '/n/b.aiff': '/n/b.aiff',
      }),
    )
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
    expect(api.cancelListFixes).toHaveBeenCalled()
    expect(api.removeListDuplicates).not.toHaveBeenCalled()
  })

  it('undoes by restoring the backup and putting Music back on the entry it wrote', async () => {
    const api = listApi()
    const { result } = listHook(LARA)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    expect(result.current.spelling).toEqual([])
    await act(() => result.current.undo())
    expect(api.trashRestore).toHaveBeenCalledWith('b1', 'undo')
    expect(api.setMusicField).toHaveBeenCalledWith(
      'PID',
      'artist',
      'DJ Lara',
      'Dj Lara',
      '/m/c.aiff',
    )
    expect(result.current.spelling).toHaveLength(1)
  })

  // Music did not go back, so the libraries keep the value Music still shows: undoing them
  // alone would split the track between Music and rekordbox.
  it.each(['mismatch', 'missing'] as const)(
    'counts a Music undo answered %s as not undone and leaves the libraries',
    async (answer) => {
      const api = listApi({
        setMusicField: vi.fn<Api['setMusicField']>().mockResolvedValue(answer),
      })
      const { result } = listHook(LARA)
      await waitFor(() => expect(result.current.status).toBe('ready'))
      act(() => result.current.toggleStaged(result.current.spelling[0].key))
      await act(() => result.current.apply())
      await act(() => result.current.undo())
      expect(api.syncLibraryTags).toHaveBeenCalledTimes(1)
      expect(result.current.lastRun).toMatchObject({ undoFailures: 1 })
    },
  )

  // A file Music does not hold was only ever written to disk; with the file back, the
  // libraries that followed it go back too.
  it('puts the libraries back for a field only the file took once the file is restored', async () => {
    const api = listApi({
      applyListFixes: vi.fn().mockResolvedValue([
        {
          id: '/m/c.aiff',
          path: '/m/c.aiff',
          fixes: [FIX],
          music: ['none'],
          file: 'written',
          written: ['artist'],
          backupId: 'b1',
        },
      ]),
    })
    const { result } = listHook(LARA)
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.toggleStaged(result.current.spelling[0].key))
    await act(() => result.current.apply())
    await act(() => result.current.undo())
    expect(api.setMusicField).not.toHaveBeenCalled()
    expect(api.syncLibraryTags).toHaveBeenLastCalledWith([
      { path: '/m/c.aiff', fields: { artist: { from: 'DJ Lara', to: 'Dj Lara' } } },
    ])
    expect(result.current.lastRun).toBeNull()
  })

  // The card showed which copy stays when the user staged it. A verdict landing afterwards
  // must not swap it: the copy removed would be the one the user saw marked to keep.
  it('keeps the copy shown at staging even when a quality verdict arrives later', async () => {
    const api = listApi()
    const spectrum = (cutoffHz: number) =>
      ({ cutoffHz, sampleRateHz: 44100, processed: false, hasKnee: true }) as TrackItem['spectrum']
    let rows = [row('/m/a.aiff', 'Ann'), row('/m/b.aiff', 'Ann')]
    const source = listReviewSource({
      rows: () => rows,
      mac: true,
      launchMusic: () => true,
      onRowsRemoved: vi.fn(),
    })
    const { result, rerender } = renderHook(() => useMusicReview(props({ source })))
    await located(result)
    const key = result.current.duplicates[0].group.key
    expect(result.current.choice(key)).toBe('/m/a.aiff')
    act(() => result.current.toggleStaged(key))
    rows = [
      row('/m/a.aiff', 'Ann', 'Song', { spectrum: spectrum(16000) }),
      row('/m/b.aiff', 'Ann', 'Song', { spectrum: spectrum(20500) }),
    ]
    rerender()
    expect(result.current.choice(key)).toBe('/m/a.aiff')
    await act(() => result.current.apply())
    expect(api.removeListDuplicates).toHaveBeenCalledWith([
      expect.objectContaining({ from: '/m/b.aiff', to: '/m/a.aiff' }),
    ])
  })

  // The freeze only holds the pick while the group sits in the tray; out of it, the card
  // goes back to suggesting the best copy it knows of.
  describe('a pick frozen at staging', () => {
    const spectrum = (cutoffHz: number) =>
      ({ cutoffHz, sampleRateHz: 44100, processed: false, hasKnee: true }) as TrackItem['spectrum']
    const staged = async () => {
      listApi()
      let rows = [row('/m/a.aiff', 'Ann'), row('/m/b.aiff', 'Ann')]
      const source = listReviewSource({
        rows: () => rows,
        mac: true,
        launchMusic: () => true,
        onRowsRemoved: vi.fn(),
      })
      const hook = renderHook(() => useMusicReview(props({ source })))
      await located(hook.result)
      const key = hook.result.current.duplicates[0].group.key
      act(() => hook.result.current.toggleStaged(key))
      rows = [
        row('/m/a.aiff', 'Ann', 'Song', { spectrum: spectrum(16000) }),
        row('/m/b.aiff', 'Ann', 'Song', { spectrum: spectrum(20500) }),
      ]
      hook.rerender()
      return { ...hook, key }
    }

    it('lets go of it when the group is unstaged', async () => {
      const { result, key } = await staged()
      act(() => result.current.toggleStaged(key))
      expect(result.current.choice(key)).toBe('/m/b.aiff')
    })

    it('lets go of it when the group is ignored', async () => {
      const { result, key } = await staged()
      act(() => result.current.ignore(key))
      expect(result.current.choice(key)).toBeNull()
    })

    it('keeps a pick the user made themselves after unstaging', async () => {
      const { result, key } = await staged()
      act(() => result.current.choose(key, '/m/a.aiff'))
      act(() => result.current.toggleStaged(key))
      expect(result.current.choice(key)).toBe('/m/a.aiff')
    })
  })

  // Same format on both sides: the measured one that is not cut at 16 kHz is the one to keep.
  it('keeps the better analyzed copy when the format ties', async () => {
    listApi()
    const spectrum = (cutoffHz: number) =>
      ({ cutoffHz, sampleRateHz: 44100, processed: false, hasKnee: true }) as TrackItem['spectrum']
    const { result } = listHook([
      row('/m/a.aiff', 'Ann', 'Song', { spectrum: spectrum(16000) }),
      row('/m/b.aiff', 'Ann', 'Song', { spectrum: spectrum(20500) }),
    ])
    await located(result)
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('/m/b.aiff')
    expect(result.current.facts('/m/b.aiff')?.spectrum?.cutoffHz).toBe(20500)
  })

  // The unmeasured copy may be the good one; the measured transcode is known not to be.
  it('keeps an unanalyzed copy over one measured as a transcode', async () => {
    listApi()
    const { result } = listHook([
      row('/m/a.aiff', 'Ann', 'Song', {
        spectrum: { cutoffHz: 16000, sampleRateHz: 44100, processed: false, hasKnee: true },
      }),
      row('/m/b.aiff', 'Ann', 'Song'),
    ])
    await located(result)
    expect(result.current.choice(result.current.duplicates[0].group.key)).toBe('/m/b.aiff')
  })
})
