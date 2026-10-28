// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useLibraryReveals } from './useLibraryReveals'

afterEach(cleanup)

const converted = {
  id: 't1',
  status: 'done',
  inputPath: '/in/Love Ya.flac',
  outputPath: '/out/Love Ya.aiff',
  rekordboxPlaylists: [{ id: 'p1', name: 'Bases' }],
} as TrackItem

function setup(
  track: TrackItem,
  available: PlaylistSource[] = ['appleMusic', 'rekordbox'],
  first?: unknown[],
) {
  const loadRekordboxPlaylist = vi
    .fn()
    .mockResolvedValue([{ path: '/out/Love Ya.aiff', separator: false, meta: {} }])
  if (first) loadRekordboxPlaylist.mockResolvedValueOnce(first)
  ;(window as unknown as { api: unknown }).api = { loadRekordboxPlaylist }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useLibraryReveals(track, available), { wrapper })
  return { hook, client, loadRekordboxPlaylist }
}

describe('useLibraryReveals', () => {
  it('offers rekordbox once its Recently added holds the converted file', async () => {
    const { hook, loadRekordboxPlaylist } = setup(converted)
    await waitFor(() => expect(hook.result.current).toEqual(['rekordbox']))
    expect(loadRekordboxPlaylist).toHaveBeenCalledWith(RECENTLY_ADDED_ID)
  })

  it('asks again when the playlists are re-read, which is when a queued add reaches rekordbox on closing it', async () => {
    const { hook, client, loadRekordboxPlaylist } = setup(converted, undefined, [])
    await waitFor(() => expect(loadRekordboxPlaylist).toHaveBeenCalledTimes(1))
    expect(hook.result.current).toEqual([])
    await act(() => client.invalidateQueries({ queryKey: ['source-playlist'] }))
    await waitFor(() => expect(hook.result.current).toEqual(['rekordbox']))
  })

  it('reads nothing for a track still to convert, so the editor costs no library read', () => {
    const { hook, loadRekordboxPlaylist } = setup({ ...converted, status: 'idle' } as TrackItem)
    expect(hook.result.current).toEqual([])
    expect(loadRekordboxPlaylist).not.toHaveBeenCalled()
  })

  it('reads nothing when rekordbox is not a tab here, since there would be nowhere to go', () => {
    const { hook, loadRekordboxPlaylist } = setup(converted, ['appleMusic'])
    expect(hook.result.current).toEqual([])
    expect(loadRekordboxPlaylist).not.toHaveBeenCalled()
  })
})
