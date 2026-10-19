// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRekordboxMembership } from './useRekordboxPlaylists'
import { useSourceBrowser } from './useSourceBrowser'

afterEach(cleanup)

function setup(
  api: Record<string, unknown>,
  platform = 'darwin',
  onPlaylistGone: (name: string, source: string) => void = () => {},
) {
  let focus: (focused: boolean) => void = () => {}
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
  const hook = renderHook(() => useSourceBrowser({ onPlaylistGone }), { wrapper })
  return { ...hook, focus: () => focus(true) }
}

describe('useSourceBrowser', () => {
  it('offers Music on macOS and rekordbox when a collection is readable', async () => {
    const { result } = setup({})
    await waitFor(() => expect(result.current.sources).toEqual(['appleMusic', 'rekordbox']))
  })

  it('offers nothing on Windows without rekordbox, so no rail is drawn', async () => {
    const { result } = setup({ rekordboxAvailable: vi.fn().mockResolvedValue(false) }, 'win32')
    await waitFor(() => expect(window.api.rekordboxAvailable).toHaveBeenCalled())
    expect(result.current.sources).toEqual([])
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
        useSourceBrowser({ onPlaylistGone: () => {} })
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

  // "Insert separator" copies the collection's own separator; with none, the menu item says
  // so instead of failing after the user picked it.
  it('knows whether rekordbox has a separator to copy', async () => {
    const { result } = setup({ rekordboxHasSeparator: vi.fn().mockResolvedValue(true) })
    expect(result.current.canInsertSeparator).toBe(false)
    act(() => result.current.selectSource('rekordbox'))
    await waitFor(() => expect(result.current.canInsertSeparator).toBe(true))
  })
})
