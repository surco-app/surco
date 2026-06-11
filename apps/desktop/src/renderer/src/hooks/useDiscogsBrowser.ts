import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import type { DiscogsRelease, DiscogsSearchResult } from '../../../shared/types'
import { bestMatch, confidenceTier, resultFromRelease } from '../lib/release'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'

// How many search results to probe for the file's track before giving up. Each probe
// loads a full release, so this caps the Discogs calls one search can make.
const MAX_AUTO_PROBE = 8

// Search fires this long after typing stops; Enter and the button fire at once.
const DEBOUNCE_MS = 500

export interface DiscogsBrowser {
  query: string
  setQuery: (q: string) => void
  doSearch: () => void
  results: DiscogsSearchResult[]
  // The release whose tracklist is open, or null when none is expanded.
  release: DiscogsRelease | null
  // The id of the result currently loading its tracklist, so its row shows a skeleton.
  loadingId: number | null
  busy: boolean
  error: string
  previewRelease: (result: DiscogsSearchResult) => void
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

// Drives the Editor's Discogs column: the search box, its results, and which release
// is expanded. Search and release loads go through React Query, so a superseded
// search is dropped by its key, releases are cached by id (an auto-open probe, a
// manual preview and a reopen all share one fetch), and a pasted id/URL loads that
// release directly. The Editor remounts per track, so state seeds from item.query.
export function useDiscogsBrowser(item: TrackItem, tr: (key: string) => string): DiscogsBrowser {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(item.query)
  // The committed search term — set by the debounce while typing, or at once on
  // Enter/the button. Drives the search query key.
  const [searchTerm, setSearchTerm] = useState('')
  // Which result is expanded. Reading the release itself from the cache (below) keeps
  // a single source of truth that auto-open, preview and reopen all set.
  const [openId, setOpenId] = useState<number | null>(null)
  const [autoProbing, setAutoProbing] = useState(false)

  const loadRelease = useCallback(
    (id: number) =>
      queryClient.fetchQuery<DiscogsRelease>({
        queryKey: ['discogs-release', id],
        // The track the user is looking at: high priority so it jumps ahead of the
        // background auto-match sweep at the main process's Discogs rate limiter.
        queryFn: () => window.api.getRelease(id, undefined, 'high'),
      }),
    [queryClient],
  )

  // Typing commits the query 500ms after it stops; Enter and the button commit at
  // once through doSearch.
  useEffect(() => {
    if (!query.trim()) return
    const id = setTimeout(() => setSearchTerm(query), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  const searchQuery = useQuery({
    queryKey: ['discogs-search', searchTerm],
    queryFn: async () => {
      // A pasted release id/URL loads that release directly instead of searching.
      const id = parseReleaseId(searchTerm)
      if (id !== null) {
        const rel = await loadRelease(id)
        return { results: [resultFromRelease(rel)], directId: rel.id as number | null }
      }
      const results = await window.api.searchDiscogs(searchTerm, undefined, 'high')
      return { results, directId: null as number | null }
    },
    enabled: searchTerm.trim() !== '',
  })
  const results = searchQuery.data?.results ?? []

  const { refetch: refetchSearch } = searchQuery
  const doSearch = useCallback(() => {
    if (!query.trim()) return
    // Re-running the search with the same term must refetch explicitly: the term (and
    // so the query key) doesn't change, and a failed search — a 429 from the limiter,
    // a network blip — would otherwise be stuck in error until the text is edited.
    if (query === searchTerm) void refetchSearch()
    else setSearchTerm(query)
  }, [query, searchTerm, refetchSearch])

  // A new search closes whatever was open before its results land, so the panel never
  // shows a release left over from the previous query.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchTerm is the deliberate trigger — resetting the open release on each new search is the point.
  useEffect(() => setOpenId(null), [searchTerm])

  // Once results arrive, open the first that confidently holds the file's track (or
  // the directly-loaded release), so the user lands on the right album. A newer search
  // supersedes an in-flight probe via the cleanup flag; editing the file's tags does
  // not re-run it — it points once per search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the resolved search data; item.meta/duration are read at probe time, not triggers — depending on them would re-probe on every keystroke.
  useEffect(() => {
    const data = searchQuery.data
    if (!data) return
    if (data.directId !== null) {
      setOpenId(data.directId)
      return
    }
    if (!item.meta.title.trim()) return
    let cancelled = false
    setAutoProbing(true)
    ;(async () => {
      for (const result of data.results.slice(0, MAX_AUTO_PROBE)) {
        let rel: DiscogsRelease
        try {
          rel = await loadRelease(result.id)
        } catch {
          continue
        }
        if (cancelled) return
        const m = bestMatch(rel.tracklist, {
          title: item.meta.title,
          durationSec: item.duration,
          trackNumber: item.meta.trackNumber,
          artist: item.meta.artist,
        })
        if (m && confidenceTier(m.confidence) !== 'low') {
          setOpenId(rel.id)
          break
        }
      }
    })().finally(() => {
      if (!cancelled) setAutoProbing(false)
    })
    return () => {
      cancelled = true
      // The superseding run may take an early-return path that never touches the flag
      // (a pasted release id, an empty title) while this run's finally is skipped as
      // cancelled — without this reset `busy` latches true and disables the Search
      // button until the editor remounts.
      setAutoProbing(false)
    }
  }, [searchQuery.data, loadRelease])

  const releaseQuery = useQuery({
    queryKey: ['discogs-release', openId],
    queryFn: () => window.api.getRelease(openId as number, undefined, 'high'),
    enabled: openId !== null,
  })
  const release = openId !== null ? (releaseQuery.data ?? null) : null

  // A click previews (expands) a result; clicking the open one collapses it again.
  const previewRelease = useCallback((result: DiscogsSearchResult) => {
    setOpenId((current) => (current === result.id ? null : result.id))
  }, [])

  const loadingId = releaseQuery.isFetching ? openId : null
  const busy = searchQuery.isFetching || autoProbing || releaseQuery.isFetching
  const error = searchQuery.isError
    ? errorMessage(searchQuery.error, tr('editor.searchError'))
    : releaseQuery.isError
      ? errorMessage(releaseQuery.error, tr('editor.releaseError'))
      : ''

  return { query, setQuery, doSearch, results, release, loadingId, busy, error, previewRelease }
}
