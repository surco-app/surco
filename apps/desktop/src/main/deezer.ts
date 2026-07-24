import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { deezerLimiter } from './deezerLimiter'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { createLookupCacheStore } from './lookupCacheStore'
import { buildSearchCandidates } from './searchQuery'

const BASE = 'https://api.deezer.com'

// Deezer signals problems inside a 200 body: quota exhaustion is `error.code` 4 and an
// empty lookup (an ISRC it doesn't carry) is 800 — the latter is a miss, not a failure.
const QUOTA_CODE = 4
const NO_DATA_CODE = 800
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface DeezerErrorBody {
  error?: { code?: number }
}

// One paced request. Quota retries take a fresh limiter token each attempt — a retry is
// another request, and skipping the limiter would hammer Deezer exactly when it is
// already signalling overload (the same reasoning as the Discogs client's 429 path).
async function api<T>(url: string, priority?: SearchPriority): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await deezerLimiter.acquire(priority)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Deezer devolvió ${res.status}`)
    const data = (await res.json()) as T & DeezerErrorBody
    const code = data.error?.code
    if (code === QUOTA_CODE) {
      if (attempt >= MAX_RETRIES)
        throw new Error('Límite de peticiones de Deezer alcanzado. Espera un momento.')
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
      continue
    }
    if (code !== undefined && code !== NO_DATA_CODE)
      throw new Error(`Deezer devolvió error ${code}`)
    return data
  }
}

interface DeezerAlbumRef {
  id: number
  title: string
  cover_medium?: string
  cover_xl?: string
}

interface DeezerTrackHit {
  id: number
  title: string
  artist?: { name?: string }
  album?: DeezerAlbumRef
}

// The search endpoint returns tracks; the results column lists releases, so hits are
// grouped into one row per album, keeping Deezer's relevance order by first appearance.
// A hit without album data names nothing fetchable and is dropped.
export function groupByAlbum(hits: DeezerTrackHit[]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<number>()
  for (const hit of hits) {
    const album = hit.album
    if (!album || seen.has(album.id)) continue
    seen.add(album.id)
    out.push({
      provider: 'deezer',
      id: album.id,
      title: hit.artist?.name ? `${hit.artist.name} - ${album.title}` : album.title,
      thumb: album.cover_medium,
      cover_image: album.cover_xl,
    })
  }
  return out
}

// Backed by userData/deezer-lookup-cache.json so a search or release already fetched
// in a previous session skips the network call on the next launch (same pattern as
// the Bandcamp client).
const cacheStore = createLookupCacheStore<SearchResult[], Release>('deezer-lookup-cache')

async function searchOnce(text: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const key = `q:${text.trim().toLowerCase()}`
  const cached = cacheStore.getSearch(key)
  if (cached) return cached
  const data = await api<{ data?: DeezerTrackHit[] }>(
    `${BASE}/search?q=${encodeURIComponent(text)}&limit=25`,
    priority,
  )
  const results = groupByAlbum(data.data ?? [])
  cacheStore.setSearch(key, results)
  return results
}

// Resolves the exact recording an ISRC names, to its album's search row. Cached under
// its own `isrc:` prefix while text searches use `q:` — the two families are namespaced
// so an ISRC key and a literal text query can never collide. A miss (Deezer's code-800
// body has no album) caches as empty and reads back as such.
async function trackByIsrc(
  isrc: string,
  priority?: SearchPriority,
): Promise<SearchResult | undefined> {
  const key = `isrc:${isrc.toLowerCase()}`
  // The identity mark is stamped on the way OUT, not into the cache: entries persisted
  // by builds before `exact` existed live on disk without it, and re-marking here keeps
  // them correct instead of leaving the ranking fix dead for already-searched tracks.
  const exact = (r: SearchResult | undefined): SearchResult | undefined =>
    r && { ...r, exact: true }
  const cached = cacheStore.getSearch(key)
  if (cached) return exact(cached[0])
  const data = await api<DeezerTrackHit>(`${BASE}/track/isrc:${encodeURIComponent(isrc)}`, priority)
  const results = groupByAlbum(data.album ? [data] : [])
  cacheStore.setSearch(key, results)
  return exact(results[0])
}

// Deezer's search is as brittle with download-filename noise as Bandcamp's, so it rides
// the same cleaned-then-relaxed candidate ladder, keeping the first candidate that
// returns anything. No catalog-number candidate: like Bandcamp, Deezer has no catalog
// index and the code would match unrelated releases.
export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
): Promise<SearchResult[]> {
  return activity.track(
    'deezer',
    'activity.searchDeezer',
    async () => {
      // An ISRC from the file's tags names the exact recording — resolve it first so
      // the original release leads the pool, with the text results as alternatives.
      const isrc = hints.isrc?.trim()
      const exact = isrc ? await trackByIsrc(isrc, priority) : undefined
      let results: SearchResult[] = []
      for (const candidate of buildSearchCandidates(query, hints, { includeCatalog: false })) {
        results = await searchOnce(candidate, priority)
        if (results.length) break
      }
      if (!exact) return results
      return [exact, ...results.filter((r) => r.id !== exact.id)]
    },
    {
      labelParams: { query },
      summary: (r) => ({ detailKey: 'activity.resultCount', detailParams: { count: r.length } }),
    },
  )
}

interface DeezerAlbumTrack {
  id: number
  title: string
  duration?: number
  track_position?: number
  artist?: { name?: string }
}

interface DeezerAlbum {
  id: number
  title: string
  artist?: { name?: string }
  contributors?: { name?: string; role?: string }[]
  release_date?: string
  genres?: { data?: { name?: string }[] }
  cover_medium?: string
  cover_xl?: string
}

// Track lengths arrive as integer seconds; the scorer compares against "m:ss", so
// convert. Zero/absent durations carry none.
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// Dates read "YYYY-MM-DD"; only the year survives into Release.
function parseYear(date: string | undefined): number | undefined {
  const m = date?.match(/^(\d{4})/)
  return m ? Number(m[1]) : undefined
}

// Main-role contributors carry a collaboration's full credit ("Ana Mena" AND
// "Lola Indigo") where `artist` names only the lead act; take them when present so the
// release credits every main artist, falling back to the lead for solo albums.
function albumArtists(album: DeezerAlbum): { name: string }[] {
  const main = (album.contributors ?? []).filter(
    (c): c is { name: string; role?: string } =>
      typeof c.name === 'string' && (c.role === undefined || c.role === 'Main'),
  )
  if (main.length) return main.map((c) => ({ name: c.name }))
  return album.artist?.name ? [{ name: album.artist.name }] : []
}

export function mapRelease(album: DeezerAlbum, tracks: DeezerAlbumTrack[]): Release {
  const cover = album.cover_xl ?? album.cover_medium
  const genres = (album.genres?.data ?? [])
    .map((g) => g.name)
    .filter((n): n is string => typeof n === 'string' && n !== '')
  return {
    provider: 'deezer',
    id: album.id,
    title: album.title,
    artists: albumArtists(album),
    year: parseYear(album.release_date),
    genres: genres.length ? genres : undefined,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: tracks.map((t, i) => ({
      position: String(t.track_position ?? i + 1),
      // A compilation names each track's own artist here; expose it so the editor's
      // Artist fills from the track, mirroring the Bandcamp mapping.
      artists: t.artist?.name ? [{ name: t.artist.name }] : undefined,
      title: t.title,
      duration: formatDuration(t.duration),
    })),
  }
}

// How many tracklist pages to follow at most: Deezer pages via `next` and 10 pages of
// 100 covers any real release; the bound keeps a malformed `next` loop from spinning.
const MAX_TRACK_PAGES = 10

export async function getRelease(id: number, priority?: SearchPriority): Promise<Release> {
  const cacheKey = String(id)
  const cached = cacheStore.getRelease(cacheKey)
  if (cached) return cached
  return activity.track(
    'deezer',
    'activity.loadDeezerRelease',
    async () => {
      const album = await api<DeezerAlbum>(`${BASE}/album/${id}`, priority)
      // The album payload embeds only the first slice of a long tracklist; the tracks
      // endpoint pages through the rest via its `next` pointer.
      const tracks: DeezerAlbumTrack[] = []
      let url: string | undefined = `${BASE}/album/${id}/tracks?limit=100`
      for (let page = 0; url && page < MAX_TRACK_PAGES; page++) {
        const chunk: { data?: DeezerAlbumTrack[]; next?: string } = await api(url, priority)
        tracks.push(...(chunk.data ?? []))
        // `next` is a URL the response body names, not one we construct — a hostile or
        // compromised response must not redirect our fetches to a third-party host.
        url = chunk.next?.startsWith(BASE) ? chunk.next : undefined
      }
      const release = mapRelease(album, tracks)
      cacheStore.setRelease(cacheKey, release)
      return release
    },
    {
      detail: String(id),
      summary: (r) => ({ detail: r.title }),
      url: `https://www.deezer.com/album/${id}`,
    },
  )
}
