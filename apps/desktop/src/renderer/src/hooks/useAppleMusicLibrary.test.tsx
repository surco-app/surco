// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppleMusicLibrary } from './useAppleMusicLibrary'

function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = over
}

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }): React.JSX.Element {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => vi.restoreAllMocks())

describe('useAppleMusicLibrary', () => {
  // The library changes in Music while Surco is in the background. Returning to Surco
  // should pick up those adds — but only once the snapshot is old enough, so a quick
  // alt-tab doesn't re-dump the whole library every time.
  it('refreshes the snapshot on refocus once it is stale, but leaves a fresh one alone', async () => {
    let focusCb: (focused: boolean) => void = () => {}
    const load = vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }])
    setApi({
      platform: 'darwin',
      loadAppleMusicLibrary: load,
      onWindowFocus: (cb: (f: boolean) => void) => {
        focusCb = cb
        return () => {}
      },
    })
    renderHook(() => useAppleMusicLibrary(3), { wrapper: wrapper() })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    // Fresh snapshot: a refocus must not re-dump the library.
    act(() => focusCb(true))
    expect(load).toHaveBeenCalledTimes(1)

    // Older than the refresh window: a refocus refetches it.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)
    act(() => focusCb(true))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  it('does not query the library off macOS', async () => {
    const load = vi.fn().mockResolvedValue([])
    setApi({ platform: 'win32', loadAppleMusicLibrary: load, onWindowFocus: () => () => {} })
    renderHook(() => useAppleMusicLibrary(3), { wrapper: wrapper() })
    await Promise.resolve()
    expect(load).not.toHaveBeenCalled()
  })
})
