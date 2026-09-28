import { errorWithKey } from '../shared/errorKeys'
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { cachedSearch, cacheIfUsable, createLookupCacheStore } from './lookupCacheStore'
import { musicbrainzLimiter } from './musicbrainzLimiter'
import { buildSearchCandidates } from './searchQuery'

const BASE = 'https://musicbrainz.org/ws/2'
const RELEASE_PAGE = 'https://musicbrainz.org/release/'
const COVER_ART = 'https://coverartarchive.org/release/'

// MusicBrainz answers 503 when a client exceeds its one request per second. The limiter
// already paces at that rate, so a 503 means someone else on the same IP is spending the
// budget too; back off and retry a bounded number of times, like Deezer's quota code.
const RATE_LIMITED = 503
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 8000

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// One paced request. Every retry takes a fresh limiter token: a retry is another request,
// and MusicBrainz blocks the IP of a client that keeps hammering through its 503s.
async function api<T>(url: string, priority?: SearchPriority): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await musicbrainzLimiter.acquire(priority)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((err: unknown) => {
      throw errorWithKey('musicbrainzUnavailable', String(err))
    })
    if (res.status === RATE_LIMITED) {
      if (attempt >= MAX_RETRIES) throw errorWithKey('musicbrainzRateLimit')
      await sleep(Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS))
      continue
    }
    if (!res.ok) throw errorWithKey('musicbrainzUnavailable', String(res.status))
    return (await res.json()) as T
  }
}

interface MbCredit {
  name: string
  joinphrase?: string
}

export interface MbReleaseSummary {
  id: string
  title: string
  status?: string
  'artist-credit'?: MbCredit[]
  'release-group'?: { 'primary-type'?: string | null; 'secondary-types'?: string[] }
  date?: string
  country?: string
  media?: { position?: number; format?: string | null; 'track-count'?: number }[]
}

export interface MbRecording {
  id: string
  score?: number
  title: string
  length?: number
  'artist-credit'?: MbCredit[]
  releases?: MbReleaseSummary[]
}

export interface MbRecordingSearch {
  count?: number
  recordings?: MbRecording[]
}

interface MbTrack {
  position: number
  number?: string
  title: string
  length?: number | null
  'artist-credit'?: MbCredit[]
}

interface MbGenre {
  name: string
  count?: number
}

export interface MbRelease {
  id: string
  title: string
  date?: string
  country?: string
  'artist-credit'?: MbCredit[]
  'label-info'?: { 'catalog-number'?: string | null; label?: { name?: string } | null }[]
  genres?: MbGenre[]
  'release-group'?: { 'primary-type'?: string | null; genres?: MbGenre[] }
  'cover-art-archive'?: { front?: boolean }
  media?: { position: number; format?: string | null; tracks?: MbTrack[] }[]
}

// SearchResult.id and Release.id are numbers, a MusicBrainz release is a UUID. The first
// 48 bits of the UUID (all random in a v4 id) make a stable safe integer, so the renderer's
// `provider:id` keys stay unique and the same release gets the same id in every session.
// The release itself is always addressed by the UUID, carried in `releaseUrl`.
export function numericIdOf(mbid: string): number {
  return Number.parseInt(mbid.replace(/-/g, '').slice(0, 12), 16)
}

// Lucene reads these as query syntax; a tag's own punctuation must be searched literally.
const LUCENE_SPECIAL = /[+\-!(){}[\]^"~*?:\\/]|&&|\|\|/g

export function escapeLucene(text: string): string {
  return text.replace(LUCENE_SPECIAL, (m) => `\\${m}`)
}

// The credit as MusicBrainz writes it: each name followed by its join phrase
// ("Kings of Tomorrow feat. Julie McKnight").
function creditText(credits: MbCredit[] | undefined): string {
  return (credits ?? []).map((c) => `${c.name}${c.joinphrase ?? ''}`).join('')
}

function creditArtists(credits: MbCredit[] | undefined): { name: string }[] {
  return (credits ?? []).filter((c) => c.name).map((c) => ({ name: c.name }))
}

function coverUrl(mbid: string, size: 250 | 500): string {
  return `${COVER_ART}${mbid}/front-${size}`
}

// The search JSON says nothing about cover art, so the thumbnail is the Cover Art Archive
// URL on faith: a release without art answers 404 and the row shows an empty thumbnail,
// which costs less than a request per row to ask first.
function releaseRow(release: MbReleaseSummary, recording: MbRecording): SearchResult {
  const artist = creditText(release['artist-credit'] ?? recording['artist-credit'])
  const formats = [
    ...new Set((release.media ?? []).map((m) => m.format).filter((f): f is string => !!f)),
  ]
  if (release['release-group']?.['secondary-types']?.includes('Compilation'))
    formats.push('Compilation')
  const year = release.date?.match(/^(\d{4})/)?.[1]
  return {
    provider: 'musicbrainz',
    id: numericIdOf(release.id),
    title: artist ? `${artist} - ${release.title}` : release.title,
    ...(year ? { year } : {}),
    ...(release.country ? { country: release.country } : {}),
    ...(formats.length ? { format: formats } : {}),
    thumb: coverUrl(release.id, 250),
    cover_image: coverUrl(release.id, 500),
    releaseUrl: `${RELEASE_PAGE}${release.id}`,
  }
}

// The recording search returns tracks; the results column lists releases, so every release
// a hit appears on becomes one row, kept in MusicBrainz' relevance order by first appearance.
export function groupByRelease(recordings: MbRecording[]): SearchResult[] {
  const out: SearchResult[] = []
  const seen = new Set<string>()
  for (const recording of recordings) {
    for (const release of recording.releases ?? []) {
      if (seen.has(release.id)) continue
      seen.add(release.id)
      out.push(releaseRow(release, recording))
    }
  }
  return out
}

const cacheStore = createLookupCacheStore<SearchResult[], Release>('musicbrainz-lookup-cache')

async function searchOnce(query: string, priority?: SearchPriority): Promise<SearchResult[]> {
  const key = `q:${query.trim().toLowerCase()}`
  const cached = cachedSearch(cacheStore, key)
  if (cached) return cached
  const data = await api<MbRecordingSearch>(
    `${BASE}/recording?query=${encodeURIComponent(query)}&fmt=json&limit=25`,
    priority,
  )
  const results = groupByRelease(data.recordings ?? [])
  cacheIfUsable(cacheStore, key, results)
  return results
}

// With artist and title from the tags, a fielded recording query is far more precise than
// free text. Compilations are excluded on the first try because a dance track sits on
// hundreds of them and they fill every slot before the original single; they come back on
// the second try for a track that only ever came out on one. Messy tags miss both, so the
// free-text candidate ladder the other sources walk is the last resort, over the recording
// index too: a file is a recording, and release titles only name the track on a single.
// Every rung is one second of the rate limit, which is why the ladder stops at the first
// rung that finds anything.
export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
): Promise<SearchResult[]> {
  return activity.track(
    'musicbrainz',
    'activity.searchMusicbrainz',
    async () => {
      const queries: string[] = []
      const artist = hints.artist?.trim()
      const title = hints.title?.trim()
      if (artist && title) {
        const fielded = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`
        queries.push(`${fielded} AND NOT secondarytype:compilation`, fielded)
      }
      for (const candidate of buildSearchCandidates(query, hints, { includeCatalog: false }))
        queries.push(escapeLucene(candidate))
      let results: SearchResult[] = []
      for (const q of queries) {
        results = await searchOnce(q, priority)
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

// Lengths arrive in milliseconds; the scorer compares against "m:ss".
function formatDuration(ms: number | null | undefined): string | undefined {
  if (!ms || !Number.isFinite(ms) || ms <= 0) return undefined
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// The release's own genre votes when it has any, else its release group's, which is where
// most MusicBrainz users tag. Strongest first, so the primary genre fills the field.
function genresOf(release: MbRelease): string[] | undefined {
  const own = release.genres ?? []
  const votes = own.length ? own : (release['release-group']?.genres ?? [])
  const names = [...votes]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .map((g) => g.name)
    .filter(Boolean)
  return names.length ? names : undefined
}

// Positions follow Discogs' shape, which splitPosition reads back: a multi-disc release
// numbers "disc-track" so track 1 of CD2 does not tag as track 1 of CD1; a vinyl side
// ("A1") already names its side and stays verbatim, like a single disc's number.
function trackPosition(disc: number, track: MbTrack, multiDisc: boolean): string {
  const number = track.number?.trim() || String(track.position)
  return multiDisc && /^\d+$/.test(number) ? `${disc}-${number}` : number
}

export function mapRelease(release: MbRelease): Release {
  const media = release.media ?? []
  const multiDisc = media.length > 1
  const cover = release['cover-art-archive']?.front ? coverUrl(release.id, 500) : undefined
  const labels = (release['label-info'] ?? [])
    .filter((l) => l.label?.name)
    .map((l) => ({ name: l.label?.name ?? '', catno: l['catalog-number'] ?? '' }))
  const formats = [...new Set(media.map((m) => m.format).filter((f): f is string => !!f))]
  const year = release.date?.match(/^(\d{4})/)?.[1]
  return {
    provider: 'musicbrainz',
    id: numericIdOf(release.id),
    title: release.title,
    artists: creditArtists(release['artist-credit']),
    year: year ? Number(year) : undefined,
    released: release.date || undefined,
    genres: genresOf(release),
    labels: labels.length ? labels : undefined,
    country: release.country || undefined,
    formats: formats.length ? formats.map((name) => ({ name })) : undefined,
    uri: `${RELEASE_PAGE}${release.id}`,
    images: cover ? [{ uri: cover, type: 'primary', resource_url: cover }] : undefined,
    tracklist: media.flatMap((m) =>
      (m.tracks ?? []).map((t) => ({
        position: trackPosition(m.position, t, multiDisc),
        title: t.title,
        // A compilation credits each track to its own act; expose it so the editor's
        // Artist fills from the track, mirroring the Deezer and Bandcamp mappings.
        artists: t['artist-credit']?.length ? creditArtists(t['artist-credit']) : undefined,
        duration: formatDuration(t.length),
      })),
    ),
  }
}

const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The ref is the row's release page URL (or a bare MBID). It crosses IPC from the renderer,
// so only a well-formed MBID is ever spliced into the request path.
function mbidOf(ref: string): string | undefined {
  const id = ref.startsWith(RELEASE_PAGE) ? ref.slice(RELEASE_PAGE.length) : ref
  return MBID.test(id) ? id.toLowerCase() : undefined
}

export async function getRelease(ref: string, priority?: SearchPriority): Promise<Release> {
  const mbid = mbidOf(ref)
  if (!mbid) throw errorWithKey('musicbrainzUnavailable', `not a release: ${ref}`)
  const cached = cacheStore.getRelease(mbid)
  if (cached) return cached
  return activity.track(
    'musicbrainz',
    'activity.loadMusicbrainzRelease',
    async () => {
      const data = await api<MbRelease>(
        `${BASE}/release/${mbid}?inc=recordings+artist-credits+labels+genres+release-groups&fmt=json`,
        priority,
      )
      const release = mapRelease(data)
      cacheStore.setRelease(mbid, release)
      return release
    },
    {
      detail: mbid,
      summary: (r) => ({ detail: r.title }),
      url: `${RELEASE_PAGE}${mbid}`,
    },
  )
}
