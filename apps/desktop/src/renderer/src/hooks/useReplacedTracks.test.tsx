// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook } from '@testing-library/react'
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
})
