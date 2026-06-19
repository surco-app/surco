import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Release,
  SearchResult,
  SearchHints,
  SearchPriority,
} from '../shared/types'
import { discogsLimiter } from './discogsLimiter'
import { isBlockedFetchUrl } from './navigation'
import { buildSearchCandidates } from './searchQuery'
import { tmpName } from './tmp'

const BASE = 'https://api.discogs.com'
const USER_AGENT = 'Surco/0.1 +https://github.com/vigosan/surco'

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
  if (Number.isFinite(headerSec) && headerSec >= 0)
    return Math.min(headerSec * 1000, MAX_DELAY_MS)
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// A stalled socket (sleep/wake, captive portal) would otherwise leave the request —
// and the rate-limiter token it spent — hanging forever; 10s is generous for an API
// that answers in well under a second.
const REQUEST_TIMEOUT_MS = 10_000

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
      await discogsLimiter.acquire(priority)
      continue
    }
    if (!res.ok) throw new Error(`Discogs devolvió ${res.status}`)
    return res.json() as Promise<T>
  }
}

const searchCache = new Map<string, SearchResult[]>()

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
  return searchCache.has(searchKey(query, opts.format, opts.perPage ?? 20))
}

async function searchOnce(
  query: string,
  token: string,
  opts: SearchOpts = {},
  priority?: SearchPriority,
): Promise<SearchResult[]> {
  const perPage = opts.perPage ?? 20
  const key = searchKey(query, opts.format, perPage)
  const cached = searchCache.get(key)
  if (cached) return cached
  // The API's `format` param filters server-side, so the whole page comes back in the
  // wanted format instead of a mix we'd thin out afterwards.
  const formatParam = opts.format ? `&format=${encodeURIComponent(opts.format)}` : ''
  const data = await api<{ results: Omit<SearchResult, 'provider'>[] }>(
    `/database/search?type=release&q=${encodeURIComponent(query)}&per_page=${perPage}${formatParam}`,
    token,
    priority,
  )
  // Discogs' JSON carries no provider tag; stamp it here so the normalized result
  // identifies its source for the pill and release routing downstream.
  const results: SearchResult[] = (data.results ?? []).map((r) => ({ ...r, provider: 'discogs' }))
  searchCache.set(key, results)
  return results
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
    const key = [r.title, r.year ?? '', (r.label ?? []).join(','), (r.format ?? []).join(',')].join(
      ' ',
    )
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
  const serverFormat = formats.length === 1 ? formats[0] : undefined
  const perPage = formats.length > 1 ? 50 : 20
  let results: SearchResult[] = []
  for (const candidate of buildSearchCandidates(query, hints)) {
    const opts: SearchOpts = { format: serverFormat, perPage }
    if (!hasCachedSearch(candidate, opts)) await discogsLimiter.acquire(priority)
    const raw = await searchOnce(candidate, token, opts, priority)
    results = dedupeResults(formats.length ? raw.filter((r) => matchesFormats(r, formats)) : raw)
    if (results.length) break
  }
  return results
}

const releaseCache = new Map<number, Release>()

export function hasCachedRelease(id: number): boolean {
  return releaseCache.has(id)
}

export async function getRelease(
  id: number,
  token: string,
  priority?: SearchPriority,
): Promise<Release> {
  const cached = releaseCache.get(id)
  if (cached) return cached
  await discogsLimiter.acquire(priority)
  const raw = await api<Omit<Release, 'provider'>>(`/releases/${id}`, token, priority)
  const release: Release = { ...raw, provider: 'discogs' }
  releaseCache.set(id, release)
  return release
}

// Sniffs the image type from the leading magic bytes, independent of the URL's
// extension or a content-type header (servers lie, and a URL dragged from a browser
// often carries none). Returns undefined when the bytes are not a known image — e.g. a
// hotlink-protection or article HTML page served in place of the picture, which is
// exactly what a link dragged from a browser can resolve to. ffmpeg can decode all four.
export function imageExt(buf: Buffer): 'jpg' | 'png' | 'gif' | 'webp' | undefined {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length >= 8 && buf.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'png'
  const head6 = buf.toString('latin1', 0, 6)
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'gif'
  if (
    buf.length >= 12 &&
    buf.toString('latin1', 0, 4) === 'RIFF' &&
    buf.toString('latin1', 8, 12) === 'WEBP'
  )
    return 'webp'
  return undefined
}

export async function downloadCover(url: string): Promise<string> {
  // The renderer names this URL, so refuse the SSRF-shaped ones (loopback, cloud
  // metadata, private ranges) before the trusted main process ever connects.
  if (isBlockedFetchUrl(url)) throw new Error('La URL de la carátula no está permitida')
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`No se pudo descargar la carátula (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Trust the bytes, not the extension: a URL that resolves to an HTML page (the common
  // outcome of a link dragged from a browser) would otherwise be saved as .jpg and only
  // blow up later inside ffmpeg with an inscrutable "No JPEG data found".
  const ext = imageExt(buf)
  if (!ext) throw new Error('La URL no apunta a una imagen')
  const path = join(tmpdir(), tmpName('cover', ext))
  await writeFile(path, buf)
  return path
}
