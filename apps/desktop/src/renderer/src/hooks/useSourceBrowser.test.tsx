// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourceNode } from '../../../shared/types'
import { useRekordboxMembership } from './useRekordboxPlaylists'
import { useSourceBrowser } from './useSourceBrowser'

afterEach(cleanup)
afterEach(() => vi.unstubAllEnvs())

function setup(
  api: Record<string, unknown>,
  platform = 'darwin',
  onPlaylistGone: (name: string, source: string) => void = () => {},
  hiddenSources: PlaylistSource[] = [],
) {
  let focus: (focused: boolean) => void = () => {}
  const state = { hidden: hiddenSources }
  ;(window as unknown as { api: unknown }).api = {
    platform,
    rekordboxAvailable: vi.fn().mockResolvedValue(true),
    loadRekordboxTree: vi
      .fn()
      .mockResolvedValue([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }]),
    loadRekordboxPlaylist: vi
      .fn()
      .mockResolvedValue([{ path: '/m/a.wav', separator: false, meta: {} }]),
    loadAppleMusicPlaylists: vi.fn().mockResolvedValue([]),
    loadAppleMusicPlaylistTracks: vi.fn(),
    engineAvailable: vi.fn().mockResolvedValue(true),
    loadEngineTree: vi
      .fn()
      .mockResolvedValue([{ id: '7', name: 'Friday', kind: 'playlist', count: 1 }]),
    loadEnginePlaylist: vi
      .fn()
      .mockResolvedValue([{ path: '/m/e.wav', separator: false, meta: {} }]),
    onWindowFocus: vi.fn((cb: (f: boolean) => void) => {
      focus = cb
      return () => {}
    }),
    ...api,
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useSourceBrowser({ onPlaylistGone, hiddenSources: state.hidden }), {
    wrapper,
  })
  return {
    ...hook,
    focus: () => focus(true),
    hide: (next: PlaylistSource[]) => {
      state.hidden = next
      hook.rerender()
    },
  }
}

describe('useSourceBrowser', () => {
  it('offers Music on macOS, rekordbox when a collection is readable, and Engine DJ', async () => {
    const { result } = setup({})
    await waitFor(() =>
      expect(result.current.sources).toEqual(['appleMusic', 'rekordbox', 'engine']),
    )
  })

  it('leaves Engine DJ out of a release build, where the source is not offered to users yet', async () => {
    vi.stubEnv('DEV', false)
    const { result } = setup({})
    await waitFor(() => expect(result.current.sources).toEqual(['appleMusic', 'rekordbox']))
  })

  it('leaves out a source the user hid, whichever one it is', async () => {
    const { result } = setup({}, 'darwin', () => {}, ['appleMusic', 'engine'])
    await waitFor(() => expect(result.current.sources).toEqual(['rekordbox']))
  })

  it('offers nothing when every source is hidden, so no rail is drawn', async () => {
    const { result } = setup({}, 'darwin', () => {}, ['appleMusic', 'rekordbox', 'engine'])
    await waitFor(() => expect(window.api.rekordboxAvailable).toHaveBeenCalled())
    expect(result.current.sources).toEqual([])
  })

  it('goes back to the working list when the open source gets hidden, so no rows of a source off the rail stay on screen', async () => {
    const { result, hide } = setup({})
    await waitFor(() =>
      expect(result.current.sources).toEqual(['appleMusic', 'rekordbox', 'engine']),
    )
    act(() => result.current.selectSource('rekordbox'))
    expect(result.current.source).toBe('rekordbox')
    hide(['rekordbox'])
    expect(result.current.source).toBeNull()
    expect(result.current.sources).toEqual(['appleMusic', 'engine'])
  })

  it('offers Engine DJ even without a library, so the DJ finds the tab that says where to set it', async () => {
    const { result } = setup(
      {
        rekordboxAvailable: vi.fn().mockResolvedValue(false),
        engineAvailable: vi.fn().mockResolvedValue(false),
      },
      'win32',
    )
    await waitFor(() => expect(window.api.rekordboxAvailable).toHaveBeenCalled())
    expect(result.current.sources).toEqual(['engine'])
  })

  it('says the Engine DJ library is missing only while Engine DJ is open and its database is not there', async () => {
    const engineAvailable = vi.fn().mockResolvedValue(false)
    const { result, focus } = setup({ engineAvailable })
    expect(result.current.libraryMissing).toBe(false)
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.libraryMissing).toBe(true))
    engineAvailable.mockResolvedValue(true)
    act(() => focus())
    await waitFor(() => expect(result.current.libraryMissing).toBe(false))
    act(() => result.current.selectSource('rekordbox'))
    expect(result.current.libraryMissing).toBe(false)
  })

  it('reads the Engine DJ tree and the picked playlist from the Engine library', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.tree?.map((n) => n.name)).toEqual(['Friday']))
    act(() =>
      result.current.selectPlaylist({ id: '7', name: 'Friday', kind: 'playlist', count: 1 }, []),
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(window.api.loadEnginePlaylist).toHaveBeenCalledWith('7')
  })

  // Music only reports how many rows a playlist has, repeats included, while the list shows
  // each file once: the tree said 3 beside a list of 2. Once the rows are read, the tree
  // counts what the list will hold (a file-less row still counts, as rekordbox's does).
  it('counts a read Music playlist by its distinct tracks, as the list shows them', async () => {
    const { result } = setup({
      loadAppleMusicPlaylists: vi
        .fn()
        .mockResolvedValue([{ persistentId: 'P1', name: 'Friday', count: 4 }]),
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.wav', '/m/b.wav', '/m/a.wav'],
        persistentIds: {},
        meta: {},
        missing: 1,
      }),
    })
    act(() => result.current.selectSource('appleMusic'))
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(4))
    act(() =>
      result.current.selectPlaylist({ id: 'P1', name: 'Friday', kind: 'playlist', count: 4 }, []),
    )
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(3))
  })

  it('loads the picked playlist rows', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(window.api.loadRekordboxPlaylist).toHaveBeenCalledWith('house')
  })

  it('re-reads which playlists the tracks are in when Surco gets the focus back, so an edit starts from what rekordbox holds now', async () => {
    const rekordboxMembership = vi.fn().mockResolvedValue({ '/m/a.wav': ['3000'] })
    const { focus } = setup({ rekordboxMembership })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    renderHook(
      () => {
        useSourceBrowser({ onPlaylistGone: () => {}, hiddenSources: [] })
        return useRekordboxMembership(['/m/a.wav'], true)
      },
      { wrapper },
    )
    await waitFor(() => expect(rekordboxMembership).toHaveBeenCalledTimes(1))
    act(() => focus())
    await waitFor(() => expect(rekordboxMembership).toHaveBeenCalledTimes(2))
  })

  it('re-reads the tree and the open playlist when Surco gets the focus back, to show what changed in rekordbox', async () => {
    const { result, focus } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    const treeCalls = vi.mocked(window.api.loadRekordboxTree).mock.calls.length
    act(() => focus())
    await waitFor(() =>
      expect(vi.mocked(window.api.loadRekordboxTree).mock.calls.length).toBeGreaterThan(treeCalls),
    )
  })

  it('closes a playlist deleted in rekordbox once the refreshed tree no longer has it', async () => {
    const loadRekordboxTree = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }])
      .mockResolvedValue([])
    const { result, focus } = setup({ loadRekordboxTree })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    act(() => focus())
    await waitFor(() => expect(result.current.playlist).toBeNull())
  })

  // The list jumping back to the whole working list with no reason reads as Surco losing
  // the playlist; naming it is what tells the user it went away in rekordbox.
  it('names the playlist that was deleted in rekordbox while it was open', async () => {
    const loadRekordboxTree = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }])
      .mockResolvedValue([])
    const onPlaylistGone = vi.fn()
    const { result, focus } = setup({ loadRekordboxTree }, 'darwin', onPlaylistGone)
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    act(() => focus())
    await waitFor(() => expect(result.current.playlist).toBeNull())
    expect(onPlaylistGone).toHaveBeenCalledTimes(1)
    expect(onPlaylistGone).toHaveBeenCalledWith('House', 'rekordbox')
  })

  // rekordbox mid-write fails one read; the playlist the user is looking at is still
  // there, and closing it would read as a deletion that never happened.
  it('keeps the open playlist when a refocus read of the tree fails', async () => {
    const loadRekordboxTree = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'house', name: 'House', kind: 'playlist', count: 1 }])
      .mockRejectedValue(new Error('database is locked'))
    const { result, focus } = setup({ loadRekordboxTree })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    act(() => focus())
    await waitFor(() => expect(result.current.treeFailed).toBe(true))
    expect(result.current.playlist?.id).toBe('house')
  })

  // Each source is its own list: another source never shows this one's playlist, and coming
  // back finds the set the DJ left open instead of making them dig it out of the tree again.
  it('keeps each source’s open playlist apart and gives it back on return', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    act(() => result.current.selectSource('appleMusic'))
    expect(result.current.playlist).toBeNull()
    act(() => result.current.selectSource(null))
    expect(result.current.playlist).toBeNull()
    act(() => result.current.selectSource('rekordbox'))
    expect(result.current.playlist?.id).toBe('house')
  })

  it('puts Recently added first in rekordbox, above every playlist, with its count', async () => {
    const { result } = setup({ rekordboxRecentCount: vi.fn().mockResolvedValue(12) })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    expect(result.current.tree?.[0]).toEqual({
      id: RECENTLY_ADDED_ID,
      name: 'sources.recentlyAdded',
      kind: 'playlist',
      count: 12,
    })
    expect(result.current.tree?.[1].id).toBe('house')
  })

  it('leaves Recently added out of Music, which has its own', async () => {
    const rekordboxRecentCount = vi.fn().mockResolvedValue(12)
    const loadAppleMusicPlaylists = vi
      .fn()
      .mockResolvedValue([{ persistentId: 'P1', name: 'Friday', count: 4 }])
    const { result } = setup({ rekordboxRecentCount, loadAppleMusicPlaylists })
    act(() => result.current.selectSource('appleMusic'))
    await waitFor(() => expect(result.current.tree).toHaveLength(1))
    expect(result.current.tree?.[0].id).toBe('P1')
    expect(rekordboxRecentCount).not.toHaveBeenCalled()
  })

  it('opens Recently added through the playlist read, so its rows behave like any playlist', async () => {
    const { result } = setup({ rekordboxRecentCount: vi.fn().mockResolvedValue(1) })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    act(() => result.current.selectPlaylist(result.current.tree?.[0] as SourceNode, []))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(window.api.loadRekordboxPlaylist).toHaveBeenCalledWith(RECENTLY_ADDED_ID)
  })

  it('re-counts Recently added whenever the tree is re-read, so a track just added to rekordbox shows up', async () => {
    const rekordboxRecentCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(2)
    const { result, focus } = setup({ rekordboxRecentCount })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(1))
    act(() => focus())
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(2))
  })

  it('puts Recently added first in Engine DJ too, above every playlist, with its count', async () => {
    const { result } = setup({ engineRecentCount: vi.fn().mockResolvedValue(5) })
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    expect(result.current.tree?.[0]).toEqual({
      id: RECENTLY_ADDED_ID,
      name: 'sources.recentlyAdded',
      kind: 'playlist',
      count: 5,
    })
    expect(result.current.tree?.[1].id).toBe('7')
  })

  it('counts each library’s own Recently added, so switching sources never shows the other’s number', async () => {
    const { result } = setup({
      rekordboxRecentCount: vi.fn().mockResolvedValue(12),
      engineRecentCount: vi.fn().mockResolvedValue(5),
    })
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(12))
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.tree?.[1]?.id).toBe('7'))
    expect(result.current.tree?.[0].count).toBe(5)
  })

  it('opens Engine DJ’s Recently added through the Engine playlist read', async () => {
    const { result } = setup({ engineRecentCount: vi.fn().mockResolvedValue(1) })
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.tree).toHaveLength(2))
    act(() => result.current.selectPlaylist(result.current.tree?.[0] as SourceNode, []))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    expect(window.api.loadEnginePlaylist).toHaveBeenCalledWith(RECENTLY_ADDED_ID)
  })

  it('re-counts Engine DJ’s Recently added on focus, so a track just added in Engine shows up', async () => {
    const engineRecentCount = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(2)
    const { result, focus } = setup({ engineRecentCount })
    act(() => result.current.selectSource('engine'))
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(1))
    act(() => focus())
    await waitFor(() => expect(result.current.tree?.[0].count).toBe(2))
  })

  // "Insert separator" copies the collection's own separator; with none, the menu item says
  // so instead of failing after the user picked it.
  it('knows whether rekordbox has a separator to copy', async () => {
    const { result } = setup({ rekordboxHasSeparator: vi.fn().mockResolvedValue(true) })
    expect(result.current.canInsertSeparator).toBe(false)
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.canInsertSeparator).toBe(true))
  })
})
