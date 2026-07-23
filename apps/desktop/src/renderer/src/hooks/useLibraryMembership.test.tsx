// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppleMusicIndex } from '../lib/appleMusicLibrary'
import { isInLibrary } from '../lib/appleMusicLibrary'
import { createQueryClient } from '../lib/queryClient'
import { useLibraryMembership } from './useLibraryMembership'

function setApi(over: Record<string, unknown>): void {
  ;(window as unknown as { api: unknown }).api = over
}

function wrapper() {
  const client = createQueryClient()
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
      loadAppleMusicLibraryCached: vi.fn().mockResolvedValue(null),
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

  // The dump takes seconds on a big library and used to leave every verdict blank
  // until it landed. The previous session's snapshot answers instantly, and the
  // fresh dump replaces it wholesale — including rows that left the library.
  it('serves the previous session snapshot until the fresh dump lands', async () => {
    let resolveDump: (lib: unknown) => void = () => {}
    const dump = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDump = resolve
      }),
    )
    const cached = vi.fn().mockResolvedValue([{ title: 'Old Song', artist: 'Old Artist' }])
    setApi({
      loadAppleMusicLibrary: dump,
      loadAppleMusicLibraryCached: cached,
      onWindowFocus: () => () => {},
    })
    const { result } = renderHook(() => useLibraryMembership(3, 'appleMusic'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(result.current).not.toBeNull())
    expect(
      isInLibrary(result.current as AppleMusicIndex, { title: 'Old Song', artist: 'Old Artist' }),
    ).toBe(true)

    resolveDump([{ title: 'New Song', artist: 'New Artist' }])
    await waitFor(() =>
      expect(
        isInLibrary(result.current as AppleMusicIndex, {
          title: 'New Song',
          artist: 'New Artist',
        }),
      ).toBe(true),
    )
    expect(
      isInLibrary(result.current as AppleMusicIndex, { title: 'Old Song', artist: 'Old Artist' }),
    ).toBe(false)
  })

  // First run (or unreadable file): null from disk means no placeholder — verdicts
  // stay blank until the dump lands, exactly the pre-cache behavior.
  it('waits for the dump when no snapshot exists', async () => {
    let resolveDump: (lib: unknown) => void = () => {}
    const dump = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveDump = resolve
      }),
    )
    const cached = vi.fn().mockResolvedValue(null)
    setApi({
      loadAppleMusicLibrary: dump,
      loadAppleMusicLibraryCached: cached,
      onWindowFocus: () => () => {},
    })
    const { result } = renderHook(() => useLibraryMembership(3, 'appleMusic'), {
      wrapper: wrapper(),
    })
    await waitFor(() => expect(cached).toHaveBeenCalledTimes(1))
    expect(result.current).toBeNull()
    resolveDump([{ title: 'One', artist: 'A' }])
    await waitFor(() => expect(result.current).not.toBeNull())
  })

  // The Engine DJ read is a local SQLite file — already instant, so it earns no disk
  // cache; the Apple-only loader must never fire for it.
  it('never reads the disk snapshot for the Engine DJ source', async () => {
    const cached = vi.fn().mockResolvedValue(null)
    const engine = vi.fn().mockResolvedValue([{ title: 'One', artist: 'A' }])
    setApi({
      loadAppleMusicLibrary: vi.fn().mockResolvedValue([]),
      loadAppleMusicLibraryCached: cached,
      loadEngineLibrary: engine,
      onWindowFocus: () => () => {},
    })
    renderHook(() => useLibraryMembership(3, 'engineDj'), { wrapper: wrapper() })
    await waitFor(() => expect(engine).toHaveBeenCalledTimes(1))
    expect(cached).not.toHaveBeenCalled()
  })
})
