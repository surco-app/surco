// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useDiscogsBrowser } from './useDiscogsBrowser'

const searchResult = { id: 1, title: 'Some Album', cover_image: 'cover.jpg' }
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
    searchDiscogs: vi.fn().mockResolvedValue([searchResult]),
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

afterEach(() => vi.restoreAllMocks())

describe('useDiscogsBrowser', () => {
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
      searchDiscogs: vi.fn().mockResolvedValue([searchResult, { ...searchResult, id: 2 }]),
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
    const searchDiscogs = vi.fn().mockResolvedValue([])
    setApi({ searchDiscogs })
    const { result } = renderHook(() => useDiscogsBrowser(item({ query: '1' }), tr), {
      wrapper: wrapper(),
    })
    act(() => result.current.doSearch())
    await waitFor(() => expect(result.current.release?.id).toBe(1))
    expect(searchDiscogs).not.toHaveBeenCalled()
  })

  // A failed search (Discogs 429, a network blip) must be retryable from the button:
  // the term doesn't change, so the query key doesn't either, and without an explicit
  // refetch the error would stay on screen until the user edits the text.
  it('retries a failed search when run again with the same term', async () => {
    setApi({
      searchDiscogs: vi
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
