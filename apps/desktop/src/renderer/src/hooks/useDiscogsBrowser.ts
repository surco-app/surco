import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchHintsOf } from '../../../shared/metadata'
import type { Release, SearchProviderId, SearchResult } from '../../../shared/types'
import { type MatchCleanup, matchTargetOf, probeReleases } from '../lib/autoMatch'
import { fetchRelease } from '../lib/fetchRelease'
import { preRankResults, providerCountsOf, releaseKey, resultFromRelease } from '../lib/release'
import { parseReleaseId } from '../lib/search'
import type { TrackItem } from '../types'

// Search fires this long after typing stops; Enter and the button fire at once.
const DEBOUNCE_MS = 500

// A stable empty array for when searchQuery.data is undefined (no search run yet, or
// the query key changed and React Query hasn't refetched). `?? []` would allocate a
// fresh array every render, which the results/providerCounts memos below depend on —
// churning their identity even with no search in flight, and defeating DiscogsPanel's
// memo on every unrelated Editor render (see DiscogsPanel.tsx).
const EMPTY_RESULTS: SearchResult[] = []
// Default for callers that don't pass `providers` (only tests today — Editor.tsx
// always passes settings.searchProviders). A default *parameter* value like
// `providers = ['discogs']` in the signature below would re-allocate on every call
// that omits the argument, same failure mode as EMPTY_RESULTS above.
const DEFAULT_PROVIDERS: SearchProviderId[] = ['discogs']

export interface DiscogsBrowser {
  query: string
  setQuery: (q: string) => void
  doSearch: () => void
  // Results after the source filter, ready to render.
  results: SearchResult[]
  // One entry per enabled catalog (in `providers` order) with its hit count in the
  // unfiltered results — counts can be 0. Keyed to the enabled sources, not to what a
  // search returned, so the source filter stays put instead of flickering per search.
  providerCounts: { provider: SearchProviderId; count: number }[]
  // The active source filter: a provider id, or 'all' for the full result set.
  providerFilter: SearchProviderId | 'all'
  setProviderFilter: (filter: SearchProviderId | 'all') => void
  // The release whose tracklist is open, or null when none is expanded (or still loading).
  release: Release | null
  // The expanded row's key (`provider:id`), or null when none is expanded. Rows are keyed
  // by provider+id because ids can collide across providers and a Bandcamp release is tied
  // to its result row (its page URL), not to a numeric id.
  openKey: string | null
  // The key (`provider:id`) of the result the probe confirmed holds the file's track, or
  // null when no probe matched. The panel badges that row "Suggested" in place — kept apart
  // from openKey so the badge stays on the probe's pick after the user opens another row.
  suggestedKey: string | null
  // Whether the expanded row's tracklist is still loading, so its row shows a skeleton.
  loading: boolean
  busy: boolean
  // Whether a search the editor auto-runs on open could still produce a verdict: a typed
  // query whose search hasn't settled — the debounce is still pending or a request is in
  // flight. The Apple Music badge reads this to show "checking" instead of flashing a
  // premature "not in library" before Discogs has had its say. Distinct from `busy`, which
  // only covers an in-flight request (and gates the Search button), not the debounce window.
  resolving: boolean
  error: string
  previewRelease: (result: SearchResult) => void
}

function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

// Drives the Editor's Discogs column: the search box, its results, and which release
// is expanded. Search and release loads go through React Query, so a superseded
// search is dropped by its key, releases are cached by id (an auto-open probe, a
// manual preview and a reopen all share one fetch), and a pasted id/URL loads that
// release directly. The Editor remounts per track, so state seeds from item.query;
// a committed term that differs from it is reported through onQueryCommitted so the
// editor can persist the refinement on the track and a switch-back restores it.
export function useDiscogsBrowser(
  item: TrackItem,
  tr: (key: string) => string,
  onQueryCommitted?: (query: string) => void,
  // The catalog sources to search, from Settings. Results are merged and re-ranked, so
  // order is irrelevant. Defaults to Discogs so callers that don't pass it (tests) behave
  // as before.
  providers: SearchProviderId[] = DEFAULT_PROVIDERS,
  // How many ranked results to show, from Settings. The auto-match probe scans the full
  // set independently, so trimming the displayed list never costs a suggestion. Defaults
  // high so callers that don't pass it (tests) keep their old behaviour.
  maxResults = 25,
  // Title-cleanup settings (the Naming pattern), so the panel's ranking, hints and
  // auto-probe score against the undressed title exactly like the sweep does.
  cleanup: MatchCleanup = {},
): DiscogsBrowser {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState(item.query)
  // The committed search term — set by the debounce while typing, or at once on
  // Enter/the button. Drives the search query key. Seeded from the file's own stored
  // release id (if any) so the panel opens straight to it, exactly like a pasted id —
  // typing afterwards commits a new term and overrides it.
  const [searchTerm, setSearchTerm] = useState(item.meta.discogsReleaseId ?? '')
  // Which result is expanded. Reading the release itself from the cache (below) keeps
  // a single source of truth that auto-open, preview and reopen all set.
  const [openResult, setOpenResult] = useState<SearchResult | null>(null)
  const [autoProbing, setAutoProbing] = useState(false)
  // The result the probe confirmed holds the file's track, kept apart from openResult: the
  // panel badges this row "Suggested", and that flag must stay on the probe's pick even after
  // the user clicks a different result open. Null until a probe matches, reset per search.
  const [suggested, setSuggested] = useState<SearchResult | null>(null)
  // Which catalog's results to show, a renderer-side view over the merged list — distinct
  // from `providers`, which decides what gets searched. Resets per search below.
  const [providerFilter, setProviderFilter] = useState<SearchProviderId | 'all'>('all')

  const loadRelease = useCallback(
    (result: SearchResult) =>
      queryClient.fetchQuery<Release>({
        queryKey: releaseKey(result),
        // The track the user is looking at: high priority so it jumps ahead of the
        // background auto-match sweep at the main process's rate limiter.
        queryFn: () => fetchRelease(result, 'high'),
      }),
    [queryClient],
  )

  // Whether the user has taken over the search box this mount (typed in it). Read by
  // the stored-id effect below: a match the sweep writes onto the track must not yank
  // the panel away from a search the user is refining by hand. Hitting Search without
  // editing doesn't count — that re-runs the same query the panel committed itself.
  const userDroveSearch = useRef(false)
  const setQueryTracked = useCallback((q: string) => {
    userDroveSearch.current = true
    setQuery(q)
  }, [])

  // The auto-match sweep can land while the panel is open: it writes the found release
  // id onto the track, but searchTerm seeds from that id only on mount — so the panel
  // kept showing the broad text-search candidates until the user flipped to another
  // track and back. When the id appears mid-mount, re-seed to it exactly like the
  // mount-time seed above (the box keeps showing item.query, same as a remount would).
  const storedId = item.meta.discogsReleaseId ?? ''
  const seenStoredId = useRef(storedId)
  useEffect(() => {
    const appeared = storedId !== '' && seenStoredId.current === ''
    seenStoredId.current = storedId
    if (!appeared || userDroveSearch.current) return
    // An id matching the release already open is the panel's own doing — the user just
    // applied a track from it (Editor's selectTrack stamps the id). Re-seeding then
    // would collapse the candidate list right after they picked from it; the release
    // is already on screen, so there is nothing to jump to.
    if (openResult?.provider === 'discogs' && String(openResult.id) === storedId) return
    setSearchTerm(storedId)
  }, [storedId, openResult])

  // Typing commits the query 500ms after it stops; Enter and the button commit at
  // once through doSearch. Skipped on mount when the panel seeded searchTerm from a stored
  // release id above: query still reads as item.query at that point (unchanged by the user),
  // so without this guard the debounce's own first run would fire 500ms later and silently
  // overwrite the seeded id with a text search — turning "open straight to this exact
  // release" into a noisy title search the user never asked for.
  const skipInitialDebounce = useRef(!!item.meta.discogsReleaseId)
  // biome-ignore lint/correctness/useExhaustiveDependencies: query is the trigger; the item/persist callback are read fresh at commit time, and depending on them would re-arm the debounce on every track edit.
  useEffect(() => {
    if (skipInitialDebounce.current) {
      skipInitialDebounce.current = false
      return
    }
    if (!query.trim()) return
    const id = setTimeout(() => {
      setSearchTerm(query)
      if (query !== item.query) onQueryCommitted?.(query)
    }, DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [query])

  // The track's own query firms up after mount: import seeds it from the file NAME and
  // the tag read then rebuilds it as "artist title" — on a slow volume that read lands
  // seconds after the editor opened, when the box has already committed the stale
  // file-name guess and is showing its homonym noise. When the stored query changes
  // under the panel and the user hasn't taken over the box, re-seed exactly as a
  // remount would. With a stored-id release on screen the box text still follows, but
  // no text search fires (the skip flag swallows the debounce run) — searching then
  // would bury the exact release the id seed just opened.
  const seenItemQuery = useRef(item.query)
  useEffect(() => {
    const changed = item.query !== seenItemQuery.current
    seenItemQuery.current = item.query
    if (!changed || userDroveSearch.current) return
    if (storedId !== '') skipInitialDebounce.current = true
    setQuery(item.query)
  }, [item.query, storedId])

  const searchQuery = useQuery({
    // The ignore words belong in the key even though the stripping happens in the main
    // process: the term the user sees doesn't change when they add a word in Settings,
    // and with staleTime Infinity the same key would keep serving the pre-setting miss —
    // the exact search the setting was added to fix.
    queryKey: ['search', searchTerm, providers, cleanup.ignoreWords ?? []],
    queryFn: async () => {
      // A pasted release id/URL loads that release directly instead of searching (Discogs
      // only — it's the one source with id-addressable releases).
      const id = parseReleaseId(searchTerm)
      if (id !== null) {
        const rel = await loadRelease({ provider: 'discogs', id, title: '' })
        const result = resultFromRelease(rel)
        return { results: [result], direct: result as SearchResult | null }
      }
      // The hint title is the same undressed title the scorer uses (matchTargetOf), so
      // the precise artist+title searches see the bare track name, not the Naming
      // pattern's "(A2) …" dressing.
      const target = matchTargetOf(item, cleanup)
      const hints = { ...searchHintsOf(item.meta), title: target.title || item.meta.title }
      // Query the enabled providers in parallel. One source failing (e.g. Bandcamp's
      // unofficial endpoint) must not sink the whole search, so surface an error only when
      // every provider failed — a partial failure still shows what did come back.
      const settled = await Promise.allSettled(
        providers.map((p) => window.api.search(searchTerm, p, 'high', hints)),
      )
      const ok = settled
        .filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === 'fulfilled')
        .map((s) => s.value)
      if (ok.length === 0) {
        const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
        throw failed ? failed.reason : new Error('search failed')
      }
      // Merge and re-rank by how well each row matches the file, so the likeliest release —
      // from whichever provider — leads, instead of one source always sitting on top.
      const results = preRankResults(ok.flat(), {
        title: target.title,
        artist: item.meta.artist,
      })
      return { results, direct: null as SearchResult | null }
    },
    enabled: searchTerm.trim() !== '',
  })
  const allResults = searchQuery.data?.results ?? EMPTY_RESULTS
  const providerCounts = useMemo(
    () => providerCountsOf(allResults, providers),
    [allResults, providers],
  )
  const results = useMemo(() => {
    if (providerFilter !== 'all')
      return allResults.filter((r) => r.provider === providerFilter).slice(0, maxResults)
    // Cap per provider, not over the merged list: Discogs is ranked ahead of Bandcamp, so a
    // single slice would let a wall of Discogs hits push every Bandcamp row past the cap while
    // the source chip still advertised "Bandcamp (n)". Keep each provider's first maxResults in
    // place, leaving the global ranked order untouched — a provider just stops contributing
    // once it has filled its quota.
    const perProvider = new Map<SearchProviderId, number>()
    return allResults.filter((r) => {
      const seen = perProvider.get(r.provider) ?? 0
      if (seen >= maxResults) return false
      perProvider.set(r.provider, seen + 1)
      return true
    })
  }, [allResults, providerFilter, maxResults])

  const { refetch: refetchSearch } = searchQuery
  const doSearch = useCallback(() => {
    if (!query.trim()) return
    // Re-running the search with the same term must refetch explicitly: the term (and
    // so the query key) doesn't change, and a failed search — a 429 from the limiter,
    // a network blip — would otherwise be stuck in error until the text is edited.
    if (query === searchTerm) void refetchSearch()
    else setSearchTerm(query)
    if (query !== item.query) onQueryCommitted?.(query)
  }, [query, searchTerm, refetchSearch, item.query, onQueryCommitted])

  // A new search closes whatever was open before its results land, so the panel never
  // shows a release left over from the previous query.
  // biome-ignore lint/correctness/useExhaustiveDependencies: searchTerm is the deliberate trigger — resetting the open release and source filter on each new search is the point.
  useEffect(() => {
    setOpenResult(null)
    setSuggested(null)
    setProviderFilter('all')
  }, [searchTerm])

  // Once results arrive, open the first that confidently holds the file's track (or
  // the directly-loaded release), so the user lands on the right album. A newer search
  // supersedes an in-flight probe via the cleanup flag; editing the file's tags does
  // not re-run it — it points once per search.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the resolved search data; item.meta/duration are read at probe time, not triggers — depending on them would re-probe on every keystroke.
  useEffect(() => {
    const data = searchQuery.data
    if (!data) return
    if (data.direct !== null) {
      setOpenResult(data.direct)
      return
    }
    if (!item.meta.title.trim()) return
    let cancelled = false
    setAutoProbing(true)
    ;(async () => {
      const m = await probeReleases(
        data.results,
        matchTargetOf(item, cleanup),
        // 'review' is enough here: the probe only opens (highlights) the release for
        // the user's own click, it never writes anything.
        { loadRelease, accepts: (tier) => tier !== 'low', cancelled: () => cancelled },
      )
      if (!cancelled && m) {
        setOpenResult(m.result)
        setSuggested(m.result)
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
    queryKey: releaseKey(openResult),
    queryFn: () => fetchRelease(openResult as SearchResult, 'high'),
    enabled: openResult !== null,
  })
  const release = openResult !== null ? (releaseQuery.data ?? null) : null

  // A click previews (expands) a result; clicking the open one collapses it again.
  const previewRelease = useCallback((result: SearchResult) => {
    setOpenResult((current) =>
      current && current.provider === result.provider && current.id === result.id ? null : result,
    )
  }, [])

  const openKey = openResult ? `${openResult.provider}:${openResult.id}` : null
  const suggestedKey = suggested ? `${suggested.provider}:${suggested.id}` : null
  const loading = releaseQuery.isFetching
  const busy = searchQuery.isFetching || autoProbing || releaseQuery.isFetching
  // A typed query whose search hasn't settled yet, including the debounce window before the
  // request even starts (query committed-to-be ≠ the term that's actually running). Not while
  // a search has errored — there's no verdict coming, so the badge must commit, not spin.
  const resolving = query.trim() !== '' && !searchQuery.isError && (busy || searchTerm !== query)
  const error = searchQuery.isError
    ? errorMessage(searchQuery.error, tr('editor.searchError'))
    : releaseQuery.isError
      ? errorMessage(releaseQuery.error, tr('editor.releaseError'))
      : ''

  // Memoized so the hook's own consumers (DiscogsPanel, wrapped in memo — see
  // DiscogsPanel.tsx) don't reconcile on every Editor render: without this the
  // return value is a fresh object literal every time, defeating that memo even
  // though every field/callback inside it is itself already stable.
  return useMemo(
    () => ({
      query,
      setQuery: setQueryTracked,
      doSearch,
      results,
      providerCounts,
      providerFilter,
      setProviderFilter,
      release,
      openKey,
      suggestedKey,
      loading,
      busy,
      resolving,
      error,
      previewRelease,
    }),
    [
      query,
      setQueryTracked,
      doSearch,
      results,
      providerCounts,
      providerFilter,
      release,
      openKey,
      suggestedKey,
      loading,
      busy,
      resolving,
      error,
      previewRelease,
    ],
  )
}
