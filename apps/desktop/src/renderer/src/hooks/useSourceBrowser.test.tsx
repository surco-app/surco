// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSourceBrowser } from './useSourceBrowser'

afterEach(cleanup)

function setup(api: Record<string, unknown>, platform = 'darwin') {
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
  const hook = renderHook(() => useSourceBrowser(), { wrapper })
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

  it('closes the playlist when switching source, so another source never shows its rows', async () => {
    const { result } = setup({})
    act(() => result.current.selectSource('rekordbox'))
    act(() =>
      result.current.selectPlaylist({ id: 'house', name: 'House', kind: 'playlist', count: 1 }, []),
    )
    act(() => result.current.selectSource('appleMusic'))
    expect(result.current.playlist).toBeNull()
  })
})
