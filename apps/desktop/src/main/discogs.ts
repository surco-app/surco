import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DiscogsRelease, DiscogsSearchResult, SearchPriority } from '../shared/types'
import { discogsLimiter } from './discogsLimiter'
import { buildSearchCandidates } from './searchQuery'
import { tmpName } from './tmp'

const BASE = 'https://api.discogs.com'
const USER_AGENT = 'Surco/0.1 +https://github.com/vigosan/vinilo'

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
// sends one, otherwise back off exponentially with a ceiling so a late attempt
// never waits absurdly long.
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

export function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const headerSec = retryAfter ? Number(retryAfter) : Number.NaN
  if (Number.isFinite(headerSec) && headerSec >= 0) return headerSec * 1000
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// A stalled socket (sleep/wake, captive portal) would otherwise leave the request —
// and the rate-limiter token it spent — hanging forever; 10s is generous for an API
// that answers in well under a second.
const REQUEST_TIMEOUT_MS = 10_000

async function api<T>(path: string, token: string): Promise<T> {
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
      continue
    }
    if (!res.ok) throw new Error(`Discogs devolvió ${res.status}`)
    return res.json() as Promise<T>
  }
}

const searchCache = new Map<string, DiscogsSearchResult[]>()

// Whether a query/id is already cached, so the rate limiter can let a repeat through without
// spending a token — a cache hit makes no network call.
export function hasCachedSearch(query: string): boolean {
  return searchCache.has(query.trim().toLowerCase())
}

async function searchOnce(query: string, token: string): Promise<DiscogsSearchResult[]> {
  const key = query.trim().toLowerCase()
  const cached = searchCache.get(key)
  if (cached) return cached
  const data = await api<{ results: DiscogsSearchResult[] }>(
    `/database/search?type=release&q=${encodeURIComponent(query)}&per_page=20`,
    token,
  )
  const results = data.results ?? []
  searchCache.set(key, results)
  return results
}

// The full Discogs search strategy: download-filename noise throws the free-text q=
// search off, so try cleaned candidates in turn (cleaned → no parenthetical) and keep
// the first that returns anything. Each candidate is paced through the shared limiter
// (skipped on a cache hit, which makes no network call) and cached on its own key, so
// a clean, already-seen query still makes exactly one — or zero — calls.
export async function search(
  query: string,
  token: string,
  priority?: SearchPriority,
): Promise<DiscogsSearchResult[]> {
  let results: DiscogsSearchResult[] = []
  for (const candidate of buildSearchCandidates(query)) {
    if (!hasCachedSearch(candidate)) await discogsLimiter.acquire(priority)
    results = await searchOnce(candidate, token)
    if (results.length) break
  }
  return results
}

const releaseCache = new Map<number, DiscogsRelease>()

export function hasCachedRelease(id: number): boolean {
  return releaseCache.has(id)
}

export async function getRelease(
  id: number,
  token: string,
  priority?: SearchPriority,
): Promise<DiscogsRelease> {
  const cached = releaseCache.get(id)
  if (cached) return cached
  await discogsLimiter.acquire(priority)
  const release = await api<DiscogsRelease>(`/releases/${id}`, token)
  releaseCache.set(id, release)
  return release
}

export async function downloadCover(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`No se pudo descargar la carátula (${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = res.headers.get('content-type')?.includes('png') ? 'png' : 'jpg'
  const path = join(tmpdir(), tmpName('cover', ext))
  await writeFile(path, buf)
  return path
}
