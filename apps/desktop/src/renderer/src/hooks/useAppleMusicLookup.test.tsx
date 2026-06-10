// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppleMusicLookup } from './useAppleMusicLookup'

function setApi(platform: string, lookup?: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = {
    platform,
    lookupAppleMusic: lookup ?? vi.fn().mockResolvedValue(false),
  }
}

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => vi.restoreAllMocks())

describe('useAppleMusicLookup', () => {
  // The library lives in the macOS Music app; on other platforms there is nothing to
  // query, so the lookup must never spawn osascript and the badge stays hidden.
  it('reports idle and never queries off macOS', () => {
    const lookup = vi.fn().mockResolvedValue(true)
    setApi('win32', lookup)
    const { result } = renderHook(() => useAppleMusicLookup('deadmau5', 'Strobe'), {
      wrapper: wrapper(),
    })
    expect(result.current).toBe('idle')
    expect(lookup).not.toHaveBeenCalled()
  })

  // A half-typed entry (missing artist or title) can't be matched, so the lookup waits
  // rather than querying the library for a partial song.
  it('reports idle and does not query until both title and artist are present', () => {
    const lookup = vi.fn().mockResolvedValue(true)
    setApi('darwin', lookup)
    const { result } = renderHook(() => useAppleMusicLookup('', 'Strobe'), { wrapper: wrapper() })
    expect(result.current).toBe('idle')
    expect(lookup).not.toHaveBeenCalled()
  })

  // Between mount and the verdict (debounce + osascript) there is no answer yet; a
  // distinct pending state lets the badge hold its space with a skeleton instead of
  // unmounting and shifting the header controls.
  it('reports pending while the verdict is still in flight', () => {
    setApi('darwin', vi.fn().mockReturnValue(new Promise(() => {})))
    const { result } = renderHook(() => useAppleMusicLookup('deadmau5', 'Strobe'), {
      wrapper: wrapper(),
    })
    expect(result.current).toBe('pending')
  })

  // The match drives the "already in library" badge that stops a duplicate import.
  it('reports yes once a present song is found in the library', async () => {
    setApi('darwin', vi.fn().mockResolvedValue(true))
    const { result } = renderHook(() => useAppleMusicLookup('deadmau5', 'Strobe'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current).toBe('yes'), { timeout: 2000 })
  })

  // The complement reassures the user the track is safe to add.
  it('reports no when the song is not in the library', async () => {
    setApi('darwin', vi.fn().mockResolvedValue(false))
    const { result } = renderHook(() => useAppleMusicLookup('Nobody', 'Unknown'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current).toBe('no'), { timeout: 2000 })
  })
})
