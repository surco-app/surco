import { errorWithKey } from '../shared/errorKeys'
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { beatportLimiter } from './beatportLimiter'
import { BEATPORT_API, type BeatportSession, createBeatportSession } from './beatportSession'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { cachedSearch, cacheIfUsable, createLookupCacheStore } from './lookupCacheStore'
import { buildSearchCandidates } from './searchQuery'

const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000
const THUMB_SIZE = '250x250'

interface Named {
  name?: string
}

export interface BeatportTrack {
  id: number
  name: string
  mix_name?: string
  bpm?: number
  isrc?: string
  length?: string
  catalog_number?: string
  new_release_date?: string
  publish_date?: string
  artists?: Named[]
  key?: Named | null
  genre?: Named | null
  sub_genre?: Named | null
  release?: { id: number; name: string; image?: { uri?: string }; label?: Named }
}

export interface BeatportRelease {
  id: number
  name: string
  slug?: string
  catalog_number?: string
  new_release_date?: string
  publish_date?: string
  artists?: Named[]
  label?: Named
  image?: { uri?: string }
}

let session: BeatportSession = createBeatportSession({
  fetch: (...args) => fetch(...args),
  credentials: () => null,
  now: Date.now,
})

export function setBeatportSession(next: BeatportSession): void {
  session = next
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function api<T>(path: string, priority?: SearchPriority): Promise<T> {
  let refreshed = false
  for (let attempt = 0; ; attempt++) {
    await beatportLimiter.acquire(priority)
    const token = await session.getAccessToken()
    const res = await fetch(`${BEATPORT_API}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw errorWithKey('beatportUnavailable', String(err))
    })
    if (res.status === 401 && !refreshed) {
      refreshed = true
      session.invalidate(token)
      continue
    }
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) throw errorWithKey('beatportRateLimit')
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
      continue
    }
    if (!res.ok) throw errorWithKey('beatportUnavailable', String(res.status))
    return (await res.json()) as T
  }
}

function names(list: Named[] | undefined): { name: string }[] {
  return (list ?? [])
    .map((a) => a.name)
    .filter((n): n is string => typeof n === 'string' && n !== '')
    .map((name) => ({ name }))
}

function sized(uri: string | undefined, size: string): string | undefined {
  return uri?.replace(/\/image_size\/\d+x\d+\//, `/image_size/${size}/`)
}

function parseYear(date: string | undefined): number | undefined {
  const m = date?.match(/^(\d{4})/)
  return m ? Number(m[1]) : undefined
}

function unique(values: (string | undefined)[]): string[] | undefined {
  const out = [...new Set(values.filter((v): v is string => typeof v === 'string' && v !== ''))]
  return out.length ? out : undefined
}

export function groupByRelease(tracks: BeatportTrack[]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<number>()
  for (const track of tracks) {
    const release = track.release
    if (!release || seen.has(release.id)) continue
    seen.add(release.id)
    const artist = names(track.artists)
      .map((a) => a.name)
      .join(', ')
    const year = parseYear(track.new_release_date ?? track.publish_date)
    out.push({
      provider: 'beatport',
      id: release.id,
      title: artist ? `${artist} - ${release.name}` : release.name,
      year: year ? String(year) : undefined,
      thumb: sized(release.image?.uri, THUMB_SIZE),
      cover_image: release.image?.uri,
      label: release.label?.name ? [release.label.name] : undefined,
      catno: track.catalog_number,
    })
  }
  return out
}

export function mapRelease(release: BeatportRelease, tracks: BeatportTrack[]): Release {
  const cover = release.image?.uri
  const date = release.new_release_date ?? release.publish_date
  return {
    provider: 'beatport',
    id: release.id,
    title: release.name,
    artists: names(release.artists),
    year: parseYear(date),
    released: date,
    genres: unique(tracks.map((t) => t.genre?.name)),
    styles: unique(tracks.map((t) => t.sub_genre?.name)),
    labels: release.label?.name
      ? [{ name: release.label.name, catno: release.catalog_number ?? '' }]
      : undefined,
    uri: `https://www.beatport.com/release/${release.slug || '-'}/${release.id}`,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: tracks.map((t, i) => ({
      position: String(i + 1),
      title: t.name,
      artists: names(t.artists).length ? names(t.artists) : undefined,
      duration: t.length || undefined,
      bpm: t.bpm ? String(t.bpm) : undefined,
      key: t.key?.name || undefined,
      mixName: t.mix_name || undefined,
      isrc: t.isrc || undefined,
    })),
  }
}

const cacheStore = createLookupCacheStore<SearchResult[], Release>('beatport-lookup-cache')

async function searchOnce(text: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const key = `q:${text.trim().toLowerCase()}`
  const cached = cachedSearch(cacheStore, key)
  if (cached) return cached
  const data = await api<{ tracks?: BeatportTrack[] }>(
    `/catalog/search/?q=${encodeURIComponent(text)}&type=tracks&per_page=25`,
    priority,
  )
  const results = groupByRelease(data.tracks ?? [])
  cacheIfUsable(cacheStore, key, results)
  return results
}

export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
): Promise<SearchResult[]> {
  return activity.track(
    'beatport',
    'activity.searchBeatport',
    async () => {
      let results: SearchResult[] = []
      for (const candidate of buildSearchCandidates(query, hints, { includeCatalog: false })) {
        results = await searchOnce(candidate, priority)
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

export async function getRelease(id: number, priority?: SearchPriority): Promise<Release> {
  const cacheKey = String(id)
  const cached = cacheStore.getRelease(cacheKey)
  if (cached) return cached
  return activity.track(
    'beatport',
    'activity.loadBeatportRelease',
    async () => {
      const release = await api<BeatportRelease>(`/catalog/releases/${id}/`, priority)
      const tracks = await api<{ results?: BeatportTrack[] }>(
        `/catalog/releases/${id}/tracks/?per_page=100`,
        priority,
      )
      const mapped = mapRelease(release, tracks.results ?? [])
      cacheStore.setRelease(cacheKey, mapped)
      return mapped
    },
    {
      detail: String(id),
      summary: (r) => ({ detail: r.title }),
      url: `https://www.beatport.com/release/-/${id}`,
    },
  )
}
