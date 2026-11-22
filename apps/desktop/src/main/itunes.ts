import { app } from 'electron'
import { errorWithKey } from '../shared/errorKeys'
import { foldAccents } from '../shared/foldAccents'
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { itunesLimiter } from './itunesLimiter'
import { cachedSearch, cacheIfUsable, createLookupCacheStore } from './lookupCacheStore'
import { searchCandidates } from './searchQuery'

const BASE = 'https://itunes.apple.com'
const RATE_LIMIT_STATUSES = new Set([403, 429])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function country(): string {
  return app.getLocaleCountryCode().toUpperCase() || 'US'
}

async function api<T>(url: string, priority?: SearchPriority): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await itunesLimiter.acquire(priority)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw errorWithKey('itunesUnavailable', String(err))
    })
    if (RATE_LIMIT_STATUSES.has(res.status)) {
      if (attempt >= MAX_RETRIES) throw errorWithKey('itunesRateLimit')
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
      continue
    }
    if (!res.ok) throw errorWithKey('itunesUnavailable', String(res.status))
    return (await res.json()) as T
  }
}

interface ItunesHit {
  artistName?: string
  trackName?: string
  collectionId?: number
  collectionName?: string
  artworkUrl100?: string
  releaseDate?: string
}

function artworkAt(url: string | undefined, size: number): string | undefined {
  return url?.replace(/\/100x100bb\.jpg$/, `/${size}x${size}bb.jpg`)
}

function yearOf(date: string | undefined): string | undefined {
  return date?.match(/^(\d{4})/)?.[1]
}

export function groupByAlbum(hits: ItunesHit[]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<number>()
  for (const hit of hits) {
    const id = hit.collectionId
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const album = hit.collectionName ?? ''
    out.push({
      provider: 'itunes',
      id,
      title: hit.artistName ? `${hit.artistName} - ${album}` : album,
      thumb: artworkAt(hit.artworkUrl100, 250),
      cover_image: artworkAt(hit.artworkUrl100, 3000),
      year: yearOf(hit.releaseDate),
    })
  }
  return out
}

function wordsOf(text: string): string[] {
  return foldAccents(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

export function hitsNamingEveryWord<H extends ItunesHit>(query: string, hits: H[]): H[] {
  const wanted = wordsOf(query)
  return hits.filter((hit) => {
    const words = new Set(
      wordsOf(`${hit.artistName ?? ''} ${hit.trackName ?? ''} ${hit.collectionName ?? ''}`),
    )
    return wanted.every((w) => words.has(w))
  })
}

const cacheStore = createLookupCacheStore<SearchResult[], Release>('itunes-lookup-cache')

export async function searchOnce(text: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const cc = country()
  const key = `q:${cc}:${text.trim().toLowerCase()}`
  const cached = cachedSearch(cacheStore, key)
  if (cached) return cached
  const data = await api<{ results?: ItunesHit[] }>(
    `${BASE}/search?term=${encodeURIComponent(text)}&entity=song&limit=200&country=${cc}`,
    priority,
  )
  const results = groupByAlbum(hitsNamingEveryWord(text, data.results ?? []))
  cacheIfUsable(cacheStore, key, results)
  return results
}

export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
): Promise<SearchResult[]> {
  return activity.track(
    'itunes',
    'activity.searchItunes',
    () => searchCandidates(query, hints, (candidate) => searchOnce(candidate, priority)),
    {
      labelParams: { query },
      summary: (r) => ({ detailKey: 'activity.resultCount', detailParams: { count: r.length } }),
    },
  )
}

interface ItunesLookupItem {
  wrapperType?: string
  collectionId?: number
  artistName?: string
  collectionName?: string
  copyright?: string
  releaseDate?: string
  primaryGenreName?: string
  artworkUrl100?: string
  trackName?: string
  trackNumber?: number
  discNumber?: number
  discCount?: number
  trackTimeMillis?: number
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms) || ms <= 0) return undefined
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function labelOf(copyright: string | undefined): string | undefined {
  const name = copyright?.replace(/^[\s℗©]*(?:\d{4}\s*)?/u, '').trim()
  return name || undefined
}

export function mapRelease(items: ItunesLookupItem[]): Release {
  const collection = items.find((i) => i.wrapperType === 'collection') ?? {}
  const tracks = items
    .filter((i) => i.wrapperType === 'track')
    .sort(
      (a, b) =>
        (a.discNumber ?? 1) - (b.discNumber ?? 1) || (a.trackNumber ?? 0) - (b.trackNumber ?? 0),
    )
  const multiDisc = tracks.some((t) => (t.discCount ?? 1) > 1 || (t.discNumber ?? 1) > 1)
  const cover = artworkAt(collection.artworkUrl100, 3000)
  const label = labelOf(collection.copyright)
  const year = yearOf(collection.releaseDate)
  return {
    provider: 'itunes',
    id: collection.collectionId ?? 0,
    title: collection.collectionName ?? '',
    artists: collection.artistName ? [{ name: collection.artistName }] : [],
    year: year ? Number(year) : undefined,
    released: collection.releaseDate?.slice(0, 10),
    genres: collection.primaryGenreName ? [collection.primaryGenreName] : undefined,
    labels: label ? [{ name: label, catno: '' }] : undefined,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: tracks.map((t, i) => {
      const number = String(t.trackNumber ?? i + 1)
      return {
        position: multiDisc ? `${t.discNumber ?? 1}-${number}` : number,
        artists: t.artistName ? [{ name: t.artistName }] : undefined,
        title: t.trackName ?? '',
        duration: formatDuration(t.trackTimeMillis),
      }
    }),
  }
}

export async function getRelease(id: number, priority?: SearchPriority): Promise<Release> {
  const cacheKey = String(id)
  const cached = cacheStore.getRelease(cacheKey)
  if (cached) return cached
  const cc = country()
  return activity.track(
    'itunes',
    'activity.loadItunesRelease',
    async () => {
      const data = await api<{ results?: ItunesLookupItem[] }>(
        `${BASE}/lookup?id=${id}&entity=song&country=${cc}`,
        priority,
      )
      const items = data.results ?? []
      if (!items.some((i) => i.wrapperType === 'collection')) {
        throw errorWithKey('itunesUnavailable', `no album ${id}`)
      }
      const release = mapRelease(items)
      cacheStore.setRelease(cacheKey, release)
      return release
    },
    {
      detail: String(id),
      summary: (r) => ({ detail: r.title }),
      url: `https://music.apple.com/${cc.toLowerCase()}/album/${id}`,
    },
  )
}
