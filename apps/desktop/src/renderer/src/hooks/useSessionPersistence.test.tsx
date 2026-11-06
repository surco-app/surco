// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { SessionData } from '../../../shared/types'
import { createAppStore } from '../lib/appStore'
import { sessionViewOf } from '../lib/sessionView'
import { dismissToastByExpiry, dismissToastByUser } from '../lib/toastQueue'
import type { TrackItem } from '../types'
import { useSessionPersistence } from './useSessionPersistence'

afterEach(() => vi.restoreAllMocks())

async function offer(session: SessionData) {
  const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
  ;(window as unknown as { api: Partial<Api> }).api = {
    getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue(session),
    saveLastSession,
  }
  const store = createAppStore()
  renderHook(() =>
    useSessionPersistence({
      tracks: [],
      tracksRef: { current: [] },
      addPaths: vi.fn(),
      seedRestoredEdits: vi.fn(),
      store,
      withdrawOffer: false,
      selectedPath: null,
      selectedPaths: [],
      selectRestored: vi.fn(),
      playbackPosition: () => null,
      resumePlayback: vi.fn(),
    }),
  )
  await waitFor(() => expect(store.getState().toasts).toHaveLength(1))
  return { store, toast: store.getState().toasts[0], saveLastSession }
}

const withEdits: SessionData = {
  paths: ['/music/a.wav'],
  edits: { '/music/a.wav': { meta: { title: 'Staged' } } as never },
}

describe('useSessionPersistence', () => {
  it('keeps a paths-only session when the offer ages out unseen, since the window can paint late', async () => {
    const { store, toast, saveLastSession } = await offer({ paths: ['/music/a.wav'], edits: {} })
    expect(toast.duration).toBeGreaterThan(0)
    dismissToastByExpiry(store, toast.id)
    expect(store.getState().toasts).toHaveLength(0)
    expect(saveLastSession).not.toHaveBeenCalled()
  })

  it('lets an offer with staged edits age out without dropping the saved session', async () => {
    const { store, toast, saveLastSession } = await offer(withEdits)
    expect(toast.duration).toBeGreaterThan(0)
    dismissToastByExpiry(store, toast.id)
    expect(store.getState().toasts).toHaveLength(0)
    expect(saveLastSession).not.toHaveBeenCalled()
  })

  it('drops a paths-only session when the offer is closed by hand', async () => {
    const { store, toast, saveLastSession } = await offer({ paths: ['/music/a.wav'], edits: {} })
    dismissToastByUser(store, toast.id)
    expect(saveLastSession).toHaveBeenCalledWith([], {})
  })

  it('still drops the saved session when the offer with edits is closed by hand', async () => {
    const { store, toast, saveLastSession } = await offer(withEdits)
    dismissToastByUser(store, toast.id)
    expect(saveLastSession).toHaveBeenCalledWith([], {})
  })

  it('saves only the Files rows, so a playlist-only row is gone after quitting', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const row = (inputPath: string, inFiles: boolean): TrackItem =>
      ({ id: inputPath, inputPath, inFiles, meta: emptyMetadata() }) as TrackItem
    const tracks = [row('/music/files.wav', true), row('/music/playlist.wav', false)]
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store: createAppStore(),
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback: vi.fn(),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession).toHaveBeenCalledWith(
      ['/music/files.wav'],
      {},
      sessionViewOf(createAppStore().getState(), null, null, []),
    )
  })

  // Quitting inside the one-second debounce used to drop the last edits on the floor: the
  // timer died with the window and nothing wrote them. The page going away flushes the
  // pending save, through a call that finishes before the renderer is gone.
  it('writes the pending session when the window goes away inside the debounce', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    const saveLastSessionSync = vi.fn<Api['saveLastSessionSync']>()
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
      saveLastSessionSync,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store: createAppStore(),
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback: vi.fn(),
      }),
    )

    window.dispatchEvent(new Event('pagehide'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()

    expect(saveLastSessionSync).toHaveBeenCalledWith(
      ['/music/a.wav'],
      {},
      sessionViewOf(createAppStore().getState(), null, null, []),
    )
    expect(saveLastSession).not.toHaveBeenCalled()
  })

  it('keeps offering Files back while only a source playlist has rows', async () => {
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi
        .fn<Api['getLastSession']>()
        .mockResolvedValue({ paths: ['/music/a.wav'], edits: {} }),
      saveLastSession: vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined),
    }
    const playlistRow = {
      id: 'p',
      inputPath: '/music/p.wav',
      meta: emptyMetadata(),
    } as TrackItem
    const store = createAppStore()
    const tracksRef = { current: [playlistRow] }
    const { rerender } = renderHook(
      ({ tracks }) =>
        useSessionPersistence({
          tracks,
          tracksRef,
          addPaths: vi.fn(),
          seedRestoredEdits: vi.fn(),
          store,
          withdrawOffer: false,
          selectedPath: null,
          selectedPaths: [],
          selectRestored: vi.fn(),
          playbackPosition: () => null,
          resumePlayback: vi.fn(),
        }),
      { initialProps: { tracks: [playlistRow] } },
    )
    await waitFor(() => expect(store.getState().toasts).toHaveLength(1))
    rerender({ tracks: [{ ...playlistRow }] })
    expect(store.getState().toasts).toHaveLength(1)
  })

  const savedView = {
    search: 'dub',
    sortBy: 'bpm',
    sortDir: 'desc',
    filters: { library: 'notInLibrary' },
    played: ['/music/a.wav'],
  }

  // Working through 700 tracks over two evenings: the reopen brings back the list the way it
  // was being read, not unfiltered and in the drop order.
  it('applies the saved list view when the reopen is accepted', async () => {
    const { store, toast } = await offer({ ...withEdits, view: savedView })
    window.api.expandPaths = vi.fn<Api['expandPaths']>().mockResolvedValue(withEdits.paths)
    await act(async () => toast.action?.onAction())
    expect(store.getState()).toMatchObject({
      search: 'dub',
      sortBy: 'bpm',
      sortDir: 'desc',
      libraryFilter: 'notInLibrary',
      playedPaths: new Set(['/music/a.wav']),
    })
  })

  // The view belongs to the list it was saved with. Without the reopen the user is starting
  // something else, and a filter left over from yesterday would hide part of today's drop.
  it('leaves the list view untouched when the reopen is not taken', async () => {
    const { store, toast } = await offer({ ...withEdits, view: savedView })
    dismissToastByExpiry(store, toast.id)
    expect(sessionViewOf(store.getState(), null, null, [])).toEqual(
      sessionViewOf(createAppStore().getState(), null, null, []),
    )
  })

  it('saves the list view when only a filter changes', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    const store = createAppStore()
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store,
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback: vi.fn(),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    act(() => store.setState({ libraryFilter: 'notInLibrary' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession).toHaveBeenLastCalledWith(
      ['/music/a.wav'],
      {},
      sessionViewOf(store.getState(), null, null, []),
    )
    expect(saveLastSession.mock.lastCall?.[2]).toMatchObject({
      filters: { library: 'notInLibrary' },
    })
  })

  it('saves the session when a track is heard, so quitting right after keeps it', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    const store = createAppStore()
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store,
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback: vi.fn(),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    act(() => store.setState({ playedPaths: new Set(['/music/a.wav']) }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession).toHaveBeenLastCalledWith(
      ['/music/a.wav'],
      {},
      sessionViewOf(store.getState(), null, null, []),
    )
    expect(saveLastSession.mock.lastCall?.[2]).toMatchObject({ played: ['/music/a.wav'] })
  })

  it('remembers which tracks were selected and the one open, for the reopen to land on', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
      { id: 'b', inputPath: '/music/b.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    const store = createAppStore()
    const { rerender } = renderHook(
      ({ selectedPath, selectedPaths }) =>
        useSessionPersistence({
          tracks,
          tracksRef: { current: tracks },
          addPaths: vi.fn(),
          seedRestoredEdits: vi.fn(),
          store,
          withdrawOffer: false,
          selectedPath,
          selectedPaths,
          selectRestored: vi.fn(),
          playbackPosition: () => null,
          resumePlayback: vi.fn(),
        }),
      {
        initialProps: {
          selectedPath: '/music/a.wav' as string | null,
          selectedPaths: ['/music/a.wav'],
        },
      },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    rerender({ selectedPath: '/music/b.wav', selectedPaths: ['/music/a.wav', '/music/b.wav'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession.mock.lastCall?.[2]).toMatchObject({
      selectedPath: '/music/b.wav',
      selectedPaths: ['/music/a.wav', '/music/b.wav'],
    })
  })

  it('saves when only the selection grows, the open track staying the same', async () => {
    vi.useFakeTimers()
    const saveLastSession = vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined)
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
      { id: 'b', inputPath: '/music/b.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    const store = createAppStore()
    const { rerender } = renderHook(
      ({ selectedPath, selectedPaths }) =>
        useSessionPersistence({
          tracks,
          tracksRef: { current: tracks },
          addPaths: vi.fn(),
          seedRestoredEdits: vi.fn(),
          store,
          withdrawOffer: false,
          selectedPath,
          selectedPaths,
          selectRestored: vi.fn(),
          playbackPosition: () => null,
          resumePlayback: vi.fn(),
        }),
      {
        initialProps: {
          selectedPath: '/music/a.wav' as string | null,
          selectedPaths: ['/music/a.wav'],
        },
      },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    rerender({ selectedPath: '/music/a.wav', selectedPaths: ['/music/a.wav', '/music/b.wav'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    expect(saveLastSession.mock.lastCall?.[2]).toMatchObject({
      selectedPath: '/music/a.wav',
      selectedPaths: ['/music/a.wav', '/music/b.wav'],
    })
  })

  // The spot in the track moves every second without touching the list, so no change
  // schedules its save: it is taken as the window goes away, the one moment it is final.
  it('writes where the playing track was as the window goes away', async () => {
    vi.useFakeTimers()
    const saveLastSessionSync = vi.fn<Api['saveLastSessionSync']>()
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession: vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined),
      saveLastSessionSync,
    }
    const tracks = [
      { id: 'a', inputPath: '/music/a.wav', inFiles: true, meta: emptyMetadata() } as TrackItem,
    ]
    let time = 12
    renderHook(() =>
      useSessionPersistence({
        tracks,
        tracksRef: { current: tracks },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store: createAppStore(),
        withdrawOffer: false,
        selectedPath: '/music/a.wav',
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => ({ path: '/music/a.wav', time }),
        resumePlayback: vi.fn(),
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    vi.useRealTimers()
    time = 199
    window.dispatchEvent(new Event('pagehide'))
    expect(saveLastSessionSync.mock.lastCall?.[2]).toMatchObject({
      playback: { path: '/music/a.wav', time: 199 },
    })
  })

  // Launching, not taking the reopen and quitting again must leave yesterday's session for
  // the launch after: the empty list was never saved this run, so leaving writes nothing.
  it('writes nothing as the window goes away when nothing was saved this run', async () => {
    const saveLastSessionSync = vi.fn<Api['saveLastSessionSync']>()
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({ paths: [], edits: {} }),
      saveLastSession: vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined),
      saveLastSessionSync,
    }
    renderHook(() =>
      useSessionPersistence({
        tracks: [],
        tracksRef: { current: [] },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store: createAppStore(),
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback: vi.fn(),
      }),
    )
    window.dispatchEvent(new Event('pagehide'))
    expect(saveLastSessionSync).not.toHaveBeenCalled()
  })

  it('hands the saved spot in the track to the player when the reopen is accepted', async () => {
    const resumePlayback = vi.fn()
    ;(window as unknown as { api: Partial<Api> }).api = {
      getLastSession: vi.fn<Api['getLastSession']>().mockResolvedValue({
        ...withEdits,
        view: { playback: { path: '/music/a.wav', time: 199 } },
      }),
      saveLastSession: vi.fn<Api['saveLastSession']>().mockResolvedValue(undefined),
      expandPaths: vi.fn<Api['expandPaths']>().mockResolvedValue(withEdits.paths),
    }
    const store = createAppStore()
    renderHook(() =>
      useSessionPersistence({
        tracks: [],
        tracksRef: { current: [] },
        addPaths: vi.fn(),
        seedRestoredEdits: vi.fn(),
        store,
        withdrawOffer: false,
        selectedPath: null,
        selectedPaths: [],
        selectRestored: vi.fn(),
        playbackPosition: () => null,
        resumePlayback,
      }),
    )
    await waitFor(() => expect(store.getState().toasts).toHaveLength(1))
    await act(async () => store.getState().toasts[0].action?.onAction())
    expect(resumePlayback).toHaveBeenCalledWith('/music/a.wav', 199)
  })
})
