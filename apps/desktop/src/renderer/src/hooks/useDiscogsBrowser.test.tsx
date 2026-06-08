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
})
