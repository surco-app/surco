import type { Release, SearchPriority, SearchResult } from '../shared/types'
import { bandcampLimiter } from './bandcampLimiter'

// Bandcamp has no public catalog API. Search rides the same autocomplete endpoint the
// site's own search bar uses; a release is read by fetching its page and parsing the
// `data-tralbum` JSON Bandcamp embeds there. Both are unofficial and can change without
// notice — the parsing is defensive and the limiter keeps the call rate gentle.
const SEARCH_URL = 'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic'
const USER_AGENT = 'Surco/0.1 +https://github.com/vigosan/surco'

// A stalled socket would otherwise leave the request — and the limiter token it spent —
// hanging forever; 10s is generous for endpoints that answer in well under a second.
const REQUEST_TIMEOUT_MS = 10_000

// Bandcamp art ships at many sizes via a numeric suffix (_0 is the original/full size);
// the autocomplete hands back the tiny _3 thumbnail. Swap the suffix to pull a crisp
// cover instead of the postage-stamp version. Returns undefined unchanged so callers can
// thread an optional image through without a guard.
export function upscaleArt(url: string | undefined, size = 0): string | undefined {
  if (!url) return undefined
  return url.replace(/_\d+\.(jpg|png|gif)$/i, `_${size}.$1`)
}

interface AutoResult {
  type: string
  id: number
  name?: string
  band_name?: string
  album_name?: string
  img?: string
  item_url_path?: string
}

// Maps an autocomplete hit to a normalized result. Only albums ('a') and tracks ('t')
// name something fetchable; band/label ('b') hits are dropped. Bandcamp carries no
// format or catalog, so those stay empty — the title and cover are what it offers, and
// the page URL is how its release is later loaded.
function mapResult(r: AutoResult): SearchResult | undefined {
  if ((r.type !== 'a' && r.type !== 't') || !r.item_url_path) return undefined
  const work = (r.type === 'a' ? (r.album_name ?? r.name) : r.name) ?? ''
  const title = r.band_name ? `${r.band_name} - ${work}` : work
  return {
    provider: 'bandcamp',
    id: r.id,
    title,
    thumb: r.img,
    cover_image: upscaleArt(r.img, 0),
    releaseUrl: r.item_url_path,
  }
}

const searchCache = new Map<string, SearchResult[]>()

export async function search(query: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const key = query.trim().toLowerCase()
  const cached = searchCache.get(key)
  if (cached) return cached
  await bandcampLimiter.acquire(priority)
  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify({ search_text: query, search_filter: '', full_page: false }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Bandcamp devolvió ${res.status}`)
  const data = (await res.json()) as { auto?: { results?: AutoResult[] } }
  const results = (data.auto?.results ?? [])
    .map(mapResult)
    .filter((r): r is SearchResult => r !== undefined)
  searchCache.set(key, results)
  return results
}

// Reverses the HTML-attribute escaping Bandcamp applies to the embedded JSON. `&amp;`
// must be undone last: doing it first would turn an escaped `&amp;quot;` into a stray
// quote and corrupt the JSON.
function unescapeHtml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

interface Tralbum {
  id: number
  artist?: string
  art_id?: number
  album_release_date?: string
  trackinfo?: { track_num?: number; title?: string; duration?: number }[]
  current?: { title?: string; release_date?: string; artist?: string; art_id?: number }
}

// Pulls the album/track JSON out of the page's `data-tralbum` attribute. Returns
// undefined when the attribute is missing or unparseable, so the caller can fail loudly
// rather than build a release from nothing.
export function extractTralbum(html: string): Tralbum | undefined {
  const m = html.match(/data-tralbum="([^"]*)"/)
  if (!m) return undefined
  try {
    return JSON.parse(unescapeHtml(m[1])) as Tralbum
  } catch {
    return undefined
  }
}

// Bandcamp dates read like "20 Apr 1998 00:00:00 GMT"; the year is the only 4-digit run.
function parseYear(date: string | undefined): number | undefined {
  const m = date?.match(/\b(\d{4})\b/)
  return m ? Number(m[1]) : undefined
}

// Track lengths arrive as seconds (a float); the scorer compares against "m:ss", so
// convert. Zero/absent durations (a heading, a stream-disabled track) carry none.
function formatDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return undefined
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The genre tags Bandcamp renders as <a class="tag"> links on the page, in their listed
// order (the first is usually the primary genre, which is what fills the genre field).
function parseTags(html: string): string[] {
  const tags: string[] = []
  const re = /<a[^>]+class="tag"[^>]*>([^<]+)<\/a>/g
  let m = re.exec(html)
  while (m !== null) {
    tags.push(m[1].trim())
    m = re.exec(html)
  }
  return tags
}

export function parseRelease(html: string, url: string): Release {
  const data = extractTralbum(html)
  if (!data) throw new Error(`No se pudo leer la página de Bandcamp (${url})`)
  const artist = data.artist ?? data.current?.artist ?? ''
  const artId = data.art_id ?? data.current?.art_id
  const cover = artId ? `https://f4.bcbits.com/img/a${artId}_0.jpg` : undefined
  const tags = parseTags(html)
  return {
    provider: 'bandcamp',
    id: data.id,
    title: data.current?.title ?? '',
    artists: artist ? [{ name: artist }] : [],
    year: parseYear(data.current?.release_date ?? data.album_release_date),
    genres: tags.length ? tags : undefined,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: (data.trackinfo ?? []).map((t) => ({
      position: t.track_num != null ? String(t.track_num) : '',
      title: t.title ?? '',
      duration: formatDuration(t.duration),
    })),
  }
}

const releaseCache = new Map<string, Release>()

// A Bandcamp release is addressed by its page URL (not a numeric id): the URL is the one
// thing the autocomplete hands back that resolves to the full album/track data.
export async function getRelease(url: string, priority?: SearchPriority): Promise<Release> {
  const cached = releaseCache.get(url)
  if (cached) return cached
  await bandcampLimiter.acquire(priority)
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Bandcamp devolvió ${res.status}`)
  const release = parseRelease(await res.text(), url)
  releaseCache.set(url, release)
  return release
}
