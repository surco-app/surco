import { dropOriginalMarker, dropPresentsAlias, trailingWordDrops } from '../shared/searchClean'
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { discogsLimiterFor } from './discogsLimiter'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { createLookupCacheStore } from './lookupCacheStore'
import { buildSearchCandidates } from './searchQuery'

const BASE = 'https://api.discogs.com'

// Surco's own Discogs app credentials. They let search work out of the box
// without each user creating a token, at the cost of a 60 req/min limit shared
// across all users. A user token (when set) takes precedence and gets its own
// bucket. These ship in the binary and are extractable — treat them as public.
const APP_KEY = 'mWMICwBUWiUpKwjXUOnG'
const APP_SECRET = 'otWEkXSaNXZehSTINgxSeTiPKsGbvNxJ'

function authParams(token: string): string {
  return token ? `token=${encodeURIComponent(token)}` : `key=${APP_KEY}&secret=${APP_SECRET}`
}

// Discogs caps requests (60/min on the shared key); a burst earns a 429. How long
// to wait before retrying: honor the server's Retry-After (seconds → ms) when it
// sends one, otherwise back off exponentially — both capped by the same ceiling so
// neither a late attempt nor an oversized header ever waits absurdly long (the wait
// holds the request's rate-limiter token, and the fetch timeout doesn't cover it).
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const headerSec = retryAfter ? Number(retryAfter) : Number.NaN
  if (Number.isFinite(headerSec) && headerSec >= 0) return Math.min(headerSec * 1000, MAX_DELAY_MS)
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function api<T>(path: string, token: string, priority?: SearchPriority): Promise<T> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}${authParams(token)}`
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (res.status === 401) throw new Error('Token de Discogs inválido.')
    if (res.status === 429) {
      // Out of retries: surface the limit so the caller can tell the user to wait.
      if (attempt >= MAX_RETRIES)
        throw new Error('Límite de peticiones de Discogs alcanzado. Espera un momento.')
      await sleep(retryDelayMs(attempt, res.headers.get('Retry-After')))
      // The caller spent one token on the first attempt; a retry is another request,
      // so take a fresh token — otherwise a 429 storm bypasses the limiter exactly
      // when Discogs is already signalling overload.
      await discogsLimiterFor(token).acquire(priority)
      continue
    }
    if (!res.ok) throw new Error(`Discogs devolvió ${res.status}`)
    return res.json() as Promise<T>
  }
}

// Backed by userData/discogs-lookup-cache.json so a search or release already
// fetched in a previous session skips both the network call and the rate-limiter
// token on the next launch, not just within one running session.
const cacheStore = createLookupCacheStore<SearchResult[], Release>('discogs-lookup-cache')

// Whether a release matches the user's format filter: empty filter accepts everything,
// otherwise the result's `format` array (e.g. ["Vinyl","LP","Album"]) must carry one of
// the selected buckets. Discogs lists the broad bucket as one of those tokens, so a plain
// membership check is enough — no token normalization needed.
export function matchesFormats(result: SearchResult, formats: string[]): boolean {
  if (formats.length === 0) return true
  const have = result.format ?? []
  return formats.some((f) => have.includes(f))
}

// One cache key per distinct request shape: the same query fetched unfiltered, filtered
// server-side to a format, or with a larger page (for client-side multi-format filtering)
// are different responses and must not share a slot.
function searchKey(query: string, format: string | undefined, perPage: number): string {
  return `${query.trim().toLowerCase()} ${format ?? ''} ${perPage}`
}

interface SearchOpts {
  format?: string
  perPage?: number
}

// Whether a query/id is already cached, so the rate limiter can let a repeat through without
// spending a token — a cache hit makes no network call. Keyed like the cache itself, so the
// format/page of the request must match for it to count as cached.
export function hasCachedSearch(query: string, opts: SearchOpts = {}): boolean {
  return cacheStore.hasSearch(searchKey(query, opts.format, opts.perPage ?? 20))
}

// Runs one /database/search request and normalizes it, sharing the cache and provider
// stamping across the two query shapes (free-text q= and the structured artist/title
// fields). `queryParams` is the shape-specific slice of the URL; `cacheId` is its cache
// identity, kept distinct from a free-text query so the two shapes never collide.
async function runSearch(
  queryParams: string,
  cacheId: string,
  token: string,
  opts: SearchOpts,
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  const perPage = opts.perPage ?? 20
  const key = searchKey(cacheId, opts.format, perPage)
  const cached = cacheStore.getSearch(key)
  if (cached) return cached
  // Pacing lives with the request itself: the token is taken here, after the cache
  // miss, so a repeat of any already-fetched shape (free-text, structured, tracklist)
  // never queues behind the limiter for a call it won't make.
  await discogsLimiterFor(token).acquire(priority)
  // The API's `format` param filters server-side, so the whole page comes back in the
  // wanted format instead of a mix we'd thin out afterwards.
  const formatParam = opts.format ? `&format=${encodeURIComponent(opts.format)}` : ''
  const data = await api<{ results: Omit<SearchResult, 'provider'>[] }>(
    `/database/search?type=release&${queryParams}&per_page=${perPage}${formatParam}`,
    token,
    priority,
  )
  // Discogs' JSON carries no provider tag; stamp it here so the normalized result
  // identifies its source for the pill and release routing downstream.
  const results: SearchResult[] = (data.results ?? []).map((r) => ({ ...r, provider: 'discogs' }))
  cacheStore.setSearch(key, results)
  return results
}

async function searchOnce(
  query: string,
  token: string,
  opts: SearchOpts = {},
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  return runSearch(`q=${encodeURIComponent(query)}`, query, token, opts, priority)
}

// The precise query: match on the catalog's own artist and release-title fields rather
// than a free-text blob. Its cache id is tagged so it can never share a slot with a
// free-text search of the same words.
async function searchStructured(
  artist: string,
  title: string,
  token: string,
  opts: SearchOpts = {},
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  const params = `artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(title)}`
  return runSearch(params, `structured ${artist} ${title}`, token, opts, priority)
}

// The tracklist query: an album track's title is not the release's title, so the
// release_title field misses it entirely — Discogs' `track` field searches inside
// tracklists and finds the album (or single) that carries the cut. Tried after
// release_title, which pins the exact single when the two coincide, and before the
// noisy free-text candidates. Cache id tagged apart from the other query shapes.
async function searchTracklist(
  artist: string,
  title: string,
  token: string,
  opts: SearchOpts = {},
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  const params = `artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}`
  return runSearch(params, `tracklist ${artist} ${title}`, token, opts, priority)
}

// The catalog number on the catalog's own catno field: as free text (q=) the code matches
// anywhere — titles, label names — and returns dozens of unrelated rows, while catno=
// returns just the pressings actually filed under it.
async function searchCatno(
  catno: string,
  token: string,
  opts: SearchOpts = {},
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  return runSearch(`catno=${encodeURIComponent(catno)}`, `catno ${catno}`, token, opts, priority)
}

// Collapses results that would render identically in the list — same title, year, label
// and format — keeping the first (Discogs ranks the most relevant pressing first). A
// search for a popular album otherwise shows the same row a dozen times, once per
// repress. Editions that differ in any shown field stay, since their tracklist or catalog
// number can be the one the user is tagging from.
export function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const r of results) {
    const key = [
      r.title,
      r.year ?? '',
      (r.label ?? []).join(','),
      (r.format ?? []).join(','),
      r.catno ?? '',
    ].join(' ')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

// The full Discogs search strategy: download-filename noise throws the free-text q=
// search off, so try cleaned candidates in turn (cleaned → no parenthetical) and keep
// the first that returns anything. Each candidate is paced through the shared limiter
// (skipped on a cache hit, which makes no network call) and cached on its own key, so
// a clean, already-seen query still makes exactly one — or zero — calls.
//
// `formats` restricts results to the user's chosen release formats. A single choice goes
// through the API's `format` param (a full page of that format); the API takes only one
// value, so several choices fetch a larger page and filter here. Either way the result is
// run through matchesFormats so the guarantee holds regardless of path. A candidate that
// yields nothing in the wanted format falls through to the next, same as an empty search.
export async function search(
  query: string,
  token: string,
  priority?: SearchPriority,
  hints?: SearchHints,
  formats: string[] = [],
): Promise<SearchResult[]> {
  return activity.track(
    'discogs',
    'activity.searchDiscogs',
    async () => {
      const serverFormat = formats.length === 1 ? formats[0] : undefined
      const perPage = formats.length > 1 ? 50 : 20
      const opts: SearchOpts = { format: serverFormat, perPage }
      const keep = (raw: SearchResult[]): SearchResult[] =>
        dedupeResults(formats.length ? raw.filter((r) => matchesFormats(r, formats)) : raw)
      // Precise first: when the tag gives both an artist and a title, match on the
      // catalog's own fields before the noisier free-text candidates. It's brittle (a
      // mistyped tag returns nothing), so an empty result falls through to free-text.
      // Raw tag values sabotage exact fields, so clean them the way the free-text
      // candidates already do: Discogs files a "pres." alias under the lead act, and
      // catalogs omit the "(Original Mix)" marker the file's title carries.
      const artist = dropPresentsAlias(hints?.artist?.trim() ?? '')
      const title = dropOriginalMarker(hints?.title?.trim() ?? '')
      if (artist && title) {
        const structured = keep(await searchStructured(artist, title, token, opts, priority))
        if (structured.length) return structured
        // Album tracks: the tag's title names a track, not a release, so try the
        // tracklist field next — still the catalog's own fields, before free text.
        const byTrack = keep(await searchTracklist(artist, title, token, opts, priority))
        if (byTrack.length) return byTrack
        // An uploader stamp glued to the END of the title ("Dancing Hearts Vicente")
        // sinks every exact query, and the free-text fallbacks below then bury the
        // panel in junk that a broad candidate returns. Retry the tracklist field
        // with trailing words dropped — still artist-pinned, so the relaxed query
        // stays precise, and a hit here preempts the noise entirely.
        for (const shorter of trailingWordDrops(title)) {
          const relaxed = keep(await searchTracklist(artist, shorter, token, opts, priority))
          if (relaxed.length) return relaxed
        }
      }
      let results: SearchResult[] = []
      // The catalog-number candidate keeps its place in the candidate order but runs on
      // the structured catno field instead of q= — same fallback turn, precise results.
      const catno = hints?.catalogNumber?.trim()
      for (const candidate of buildSearchCandidates(query, hints)) {
        const raw =
          candidate === catno
            ? await searchCatno(candidate, token, opts, priority)
            : await searchOnce(candidate, token, opts, priority)
        results = keep(raw)
        if (results.length) break
      }
      return results
    },
    {
      labelParams: { query },
      summary: (r) => ({ detailKey: 'activity.resultCount', detailParams: { count: r.length } }),
    },
  )
}

export function hasCachedRelease(id: number): boolean {
  return cacheStore.hasRelease(id)
}

export async function getRelease(
  id: number,
  token: string,
  priority?: SearchPriority,
): Promise<Release> {
  const cached = cacheStore.getRelease(id)
  if (cached) return cached
  return activity.track(
    'discogs',
    'activity.loadDiscogsRelease',
    async () => {
      await discogsLimiterFor(token).acquire(priority)
      const raw = await api<Omit<Release, 'provider'>>(`/releases/${id}`, token, priority)
      const release: Release = { ...raw, provider: 'discogs' }
      cacheStore.setRelease(id, release)
      return release
    },
    {
      labelParams: { id },
      detail: `${BASE}/releases/${id}`,
      // The release title is data, not UI text, so it passes through raw.
      summary: (r) => ({ detail: r.title }),
      // The human release page (not the API endpoint in detail), for the row's open link.
      url: `https://www.discogs.com/release/${id}`,
    },
  )
}
