// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useReplacedTracks } from './useReplacedTracks'

afterEach(cleanup)

describe('useReplacedTracks', () => {
  // The tree and the To review list are memoized on this list; a fresh empty list on each
  // render while the store is still being read would rebuild them on every render.
  it('hands back the same empty list on every render until the store is read', () => {
    ;(window as unknown as { api: unknown }).api = {
      replacedTracks: vi.fn(() => new Promise(() => {})),
      onReplacedChanged: () => () => {},
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, rerender } = renderHook(() => useReplacedTracks(), { wrapper })
    const first = result.current
    rerender()
    expect(first).toEqual([])
    expect(result.current).toBe(first)
  })

  it('reads the store again when the main process changes it, so a track Traktor kept on its old file leaves To review', async () => {
    let changed = () => {}
    const replacedTracks = vi
      .fn()
      .mockResolvedValueOnce([{ newPath: '/m/new.flac', pending: ['traktor'] }])
      .mockResolvedValueOnce([])
    ;(window as unknown as { api: unknown }).api = {
      replacedTracks,
      onReplacedChanged: (cb: () => void) => {
        changed = cb
        return () => {}
      },
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useReplacedTracks(), { wrapper })
    await waitFor(() => expect(result.current).toHaveLength(1))
    act(() => changed())
    await waitFor(() => expect(result.current).toEqual([]))
  })
})
