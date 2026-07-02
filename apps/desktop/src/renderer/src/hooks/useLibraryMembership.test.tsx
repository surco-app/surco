// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useLibraryMembership } from './useLibraryMembership'

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

describe('useLibraryMembership', () => {
  // The library changes in Music while Surco is in the background. Returning to Surco
  // should pick up those adds — but only once the snapshot is old enough, so a quick
  // alt-tab doesn't re-dump the whole library every time.
  it('refreshes the snapshot on refocus once it is stale, but leaves a fresh one alone', async () => {
    let focusCb: (focused: boolean) => void = () => {}
    const load = vi.fn().mockResolvedValue([{ title: 'Strobe', artist: 'deadmau5' }])
    setApi({
      loadAppleMusicLibrary: load,
      onWindowFocus: (cb: (f: boolean) => void) => {
        focusCb = cb
        return () => {}
      },
    })
    renderHook(() => useLibraryMembership(3, 'appleMusic'), { wrapper: wrapper() })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))

    // Fresh snapshot: a refocus must not re-dump the library.
    act(() => focusCb(true))
    expect(load).toHaveBeenCalledTimes(1)

    // Older than the refresh window: a refocus refetches it.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6 * 60_000)
    act(() => focusCb(true))
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })

  // Folder / overwrite destinations land in no library — there is nothing to check,
  // so neither bridge should be spawned.
  it('queries nothing without a library source', async () => {
    const apple = vi.fn().mockResolvedValue([])
    const engine = vi.fn().mockResolvedValue([])
    setApi({
      loadAppleMusicLibrary: apple,
      loadEngineLibrary: engine,
      onWindowFocus: () => () => {},
    })
    renderHook(() => useLibraryMembership(3, null), { wrapper: wrapper() })
    await Promise.resolve()
    expect(apple).not.toHaveBeenCalled()
    expect(engine).not.toHaveBeenCalled()
  })

  // The Engine DJ destination reads the Engine database, never the Apple Music bridge —
  // that is the whole point of the destination-aware check.
  it('reads the Engine library when it is the source', async () => {
    const apple = vi.fn().mockResolvedValue([])
    const engine = vi.fn().mockResolvedValue([{ title: 'One', artist: 'A' }])
    setApi({
      loadAppleMusicLibrary: apple,
      loadEngineLibrary: engine,
      onWindowFocus: () => () => {},
    })
    renderHook(() => useLibraryMembership(3, 'engineDj'), { wrapper: wrapper() })
    await waitFor(() => expect(engine).toHaveBeenCalledTimes(1))
    expect(apple).not.toHaveBeenCalled()
  })
})
