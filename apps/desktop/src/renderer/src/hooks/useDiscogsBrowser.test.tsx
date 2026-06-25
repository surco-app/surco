// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useDiscogsBrowser } from './useDiscogsBrowser'

const searchResult = {
  provider: 'discogs' as const,
  id: 1,
  title: 'Some Album',
  cover_image: 'cover.jpg',
}
const release = {
  id: 1,
  title: 'Some Album',
  artists: [{ name: 'The Artist' }],
  tracklist: [
    { position: 'A1', title: 'Track One', duration: '3:21' },
    { position: 'A2', title: 'Track Two', duration: '7:45' },
  ],
}

function setApi(over: Record<string, unknown> = {}): void {
  ;(window as unknown as { api: unknown }).api = {
    platform: 'win32',
    search: vi.fn().mockResolvedValue([searchResult]),
    getRelease: vi.fn().mockResolvedValue(release),
    ...over,
  }
}

function item(over: { query?: string; title?: string } = {}): TrackItem {
  const meta = { title: over.title ?? '' } as TrackMetadata
  return {
    id: 'a',
    inputPath: '/m/a.wav',
    fileName: 'a.wav',
    listLabel: over.title ?? 'a.wav',
    query: over.query ?? '',
    meta,
    status: 'idle',
  }
}

const tr = (k: string): string => k

function wrapper(): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

// Unmount the hooks too: a mounted browser keeps a 500ms debounce timer armed, and
// one left over from the file's last test fires after the environment is torn down.
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useDiscogsBrowser', () => {
  // With more than one source enabled the list must show hits from all of them, so the
  // user sees Bandcamp-only releases alongside Discogs ones in a single ranked list.
  it('merges results from every enabled provider', async () => {
    const bcResult = {
      provider: 'bandcamp' as const,
      id: 9,
      title: 'BC Album',
      releaseUrl: 'https://x.bc/a',
    }
    setApi({
      search: vi.fn(async (_q: string, provider?: string) =>
        provider === 'bandcamp' ? [bcResult] : [searchResult],
      ),
    })
    const { result } = renderHook(
      () =>
        useDiscogsBrowser(item({ query: 'some album' }), tr, undefined, ['discogs', 'bandcamp']),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(2))
    expect(result.current.results.map((r) => r.provider).sort()).toEqual(['bandcamp', 'discogs'])
  })

  // A broad query can return dozens of rows — a wall of noise. The displayed list is capped,
  // but the per-provider counts still report the true total so the source chips stay honest.
  it('caps the displayed list while the provider counts keep the true total', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      provider: 'discogs' as const,
      id: i + 1,
      title: `Some Album ${i}`,
    }))
    setApi({ search: vi.fn().mockResolvedValue(many) })
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: 'some album' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.results).toHaveLength(25)
    expect(result.current.providerCounts).toEqual([{ provider: 'discogs', count: 40 }])
  })

  // The cap must apply per provider, not to the merged list: Discogs is ranked ahead of
  // Bandcamp, so a single slice over the merge would let a wall of Discogs hits push every
  // Bandcamp row past the cap — and the source chip would advertise "Bandcamp (n)" for rows
  // the "all" view never shows. Each provider keeps up to the cap, so Bandcamp stays visible.
  it('caps each provider so a Discogs-heavy result set never buries Bandcamp', async () => {
    const discogsMany = Array.from({ length: 40 }, (_, i) => ({
      provider: 'discogs' as const,
      id: i + 1,
      title: `Some Album ${i}`,
    }))
    const bcResult = {
      provider: 'bandcamp' as const,
      id: 999,
      title: 'Some Album BC',
      releaseUrl: 'https://x.bc/a',
    }
    setApi({
      search: vi.fn(async (_q: string, provider?: string) =>
        provider === 'bandcamp' ? [bcResult] : discogsMany,
      ),
    })
    const { result } = renderHook(
      () =>
        useDiscogsBrowser(item({ query: 'some album' }), tr, undefined, ['discogs', 'bandcamp']),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    // Discogs capped to 25, Bandcamp's lone row still present — not slid off the end.
    expect(result.current.results.filter((r) => r.provider === 'discogs')).toHaveLength(25)
    expect(result.current.results.some((r) => r.provider === 'bandcamp')).toBe(true)
  })

  // The cap is the user's Settings → Search "Maximum results" choice, threaded in so a DJ
  // who wants a tighter list (less compilation/reissue noise) gets exactly that.
  it('caps the displayed list to the configured maximum', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      provider: 'discogs' as const,
      id: i + 1,
      title: `Some Album ${i}`,
    }))
    setApi({ search: vi.fn().mockResolvedValue(many) })
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'some album' }), tr, undefined, ['discogs'], 10),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results.length).toBeGreaterThan(0))
    expect(result.current.results).toHaveLength(10)
    expect(result.current.providerCounts).toEqual([{ provider: 'discogs', count: 40 }])
  })

  // The source filter narrows the merged list to one catalog without re-searching, and
  // counts every source so the user can see (and pick) where results came from.
  it('filters the merged results to a single provider', async () => {
    const bcResult = {
      provider: 'bandcamp' as const,
      id: 9,
      title: 'BC Album',
      releaseUrl: 'https://x.bc/a',
    }
    setApi({
      search: vi.fn(async (_q: string, provider?: string) =>
        provider === 'bandcamp' ? [bcResult] : [searchResult],
      ),
    })
    const { result } = renderHook(
      () =>
        useDiscogsBrowser(item({ query: 'some album' }), tr, undefined, ['discogs', 'bandcamp']),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(2))
    expect(result.current.providerCounts).toEqual([
      { provider: 'discogs', count: 1 },
      { provider: 'bandcamp', count: 1 },
    ])

    act(() => result.current.setProviderFilter('bandcamp'))
    expect(result.current.results.map((r) => r.provider)).toEqual(['bandcamp'])
  })

  // A new search resets the active filter (so a Bandcamp-only filter can't blank a later
  // Discogs-heavy result set) but keeps a slot for every enabled catalog — Bandcamp stays
  // listed at 0 rather than vanishing, so the control holds steady across searches.
  it('resets the filter on a new search yet keeps a slot for each enabled provider', async () => {
    const bcResult = {
      provider: 'bandcamp' as const,
      id: 9,
      title: 'BC Album',
      releaseUrl: 'https://x.bc/a',
    }
    let mixed = true
    setApi({
      search: vi.fn(async (_q: string, provider?: string) =>
        mixed && provider === 'bandcamp'
          ? [bcResult]
          : provider === 'bandcamp'
            ? []
            : [searchResult],
      ),
    })
    const { result } = renderHook(
      () =>
        useDiscogsBrowser(item({ query: 'some album' }), tr, undefined, ['discogs', 'bandcamp']),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(2))
    act(() => result.current.setProviderFilter('bandcamp'))
    expect(result.current.results).toHaveLength(1)

    mixed = false
    act(() => result.current.setQuery('other album'))
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(result.current.results[0].provider).toBe('discogs')
    expect(result.current.providerFilter).toBe('all')
    expect(result.current.providerCounts).toEqual([
      { provider: 'discogs', count: 1 },
      { provider: 'bandcamp', count: 0 },
    ])
  })

  // The search box's whole job: commit the query and surface the matching releases.
  it('returns the search results once a search is run', async () => {
    setApi()
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: 'some album' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(result.current.results[0].id).toBe(1)
  })

  // A click expands a result; clicking the open one collapses it. This is the toggle
  // the results list relies on, and browsing must never apply anything on its own.
  it('opens a release on preview and closes it when previewed again', async () => {
    setApi()
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: 'some album' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    act(() => result.current.previewRelease(searchResult))
    await waitFor(() => expect(result.current.release?.id).toBe(1))
    act(() => result.current.previewRelease(searchResult))
    await waitFor(() => expect(result.current.release).toBeNull())
  })

  // After a search the result that confidently holds the file's track opens on its
  // own, so the user lands on the right album without opening each result by hand.
  it('auto-opens the result whose tracklist matches the file title', async () => {
    setApi()
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'some album', title: 'Track One' }), tr),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.release?.id).toBe(1))
  })

  // The probe walks the results in order; one structurally broken release (no
  // tracklist) must be skipped like a failed load, not thrown out of the probe —
  // which would leave busy latched and surface an unhandled rejection.
  it('skips a malformed release in the probe and opens the next match', async () => {
    const getRelease = vi.fn((id: number) => {
      if (id === 1) return Promise.resolve({ id: 1, title: 'Broken' })
      return Promise.resolve({ ...release, id })
    })
    setApi({
      search: vi.fn().mockResolvedValue([searchResult, { ...searchResult, id: 2 }]),
      getRelease,
    })
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'some album', title: 'Track One' }), tr),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.release?.id).toBe(2))
    expect(result.current.busy).toBe(false)
  })

  // The auto-open probe is a guess that must not run with nothing to match against:
  // with no title it never loads a release, so it can never open or mutate anything.
  it('does not probe or auto-open when the file has no title', async () => {
    const getRelease = vi.fn().mockResolvedValue(release)
    setApi({ getRelease })
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: 'some album' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(result.current.release).toBeNull()
    expect(getRelease).not.toHaveBeenCalled()
  })

  // A pasted release id loads that release directly instead of running a text search,
  // so the user can jump straight to a known release.
  it('loads a release directly from a pasted id without searching', async () => {
    const search = vi.fn().mockResolvedValue([])
    setApi({ search })
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: '1' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.release?.id).toBe(1))
    expect(search).not.toHaveBeenCalled()
  })

  // A refined search is navigation state the user expects to survive a track flip;
  // the hook reports the committed term upward so the editor can store it on the
  // track, and the per-track remount then re-seeds the box (and the cached results).
  it('reports a committed term that differs from the track’s stored query', async () => {
    setApi()
    const onQueryCommitted = vi.fn()
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'parsed guess' }), tr, onQueryCommitted),
      { wrapper: wrapper() },
    )
    act(() => result.current.setQuery('refined term'))
    act(() => result.current.doSearch())
    expect(onQueryCommitted).toHaveBeenCalledWith('refined term')
  })

  it('does not report the track’s own query committing on mount', async () => {
    setApi()
    const onQueryCommitted = vi.fn()
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'parsed guess' }), tr, onQueryCommitted),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(onQueryCommitted).not.toHaveBeenCalled()
  })

  // A failed search (Discogs 429, a network blip) must be retryable from the button:
  // the term doesn't change, so the query key doesn't either, and without an explicit
  // refetch the error would stay on screen until the user edits the text.
  it('retries a failed search when run again with the same term', async () => {
    setApi({
      search: vi
        .fn()
        .mockRejectedValueOnce(new Error('rate limited'))
        .mockResolvedValue([searchResult]),
    })
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: 'some album' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.error).not.toBe(''))

    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.results).toHaveLength(1))
    expect(result.current.error).toBe('')
  })

  // Pasting a release URL while a free-text auto-probe is still in flight takes the
  // direct-id path, which never touches the probing flag; the superseded run must not
  // leave `busy` latched true, or the Search button stays disabled until a remount.
  it('clears busy when a direct release load supersedes an in-flight probe', async () => {
    const getRelease = vi.fn((id: number) => {
      if (id === 123) return Promise.resolve({ ...release, id: 123 })
      return new Promise(() => {})
    })
    setApi({ getRelease })
    const { result } = renderHook(
      () => useDiscogsBrowser(item({ query: 'some album', title: 'Track One' }), tr),
      { wrapper: wrapper() },
    )
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.busy).toBe(true))

    act(() => result.current.setQuery('https://www.discogs.com/release/123'))
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.release?.id).toBe(123))
    expect(result.current.busy).toBe(false)
  })
})
