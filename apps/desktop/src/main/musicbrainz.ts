import { errorWithKey } from '../shared/errorKeys'
import { bareAlbumTitle } from '../shared/searchClean'
import type { Release, SearchHints, SearchPriority, SearchResult } from '../shared/types'
import { activity } from './activity'
import { REQUEST_TIMEOUT_MS, USER_AGENT } from './http'
import { cachedSearch, cacheIfUsable, createLookupCacheStore } from './lookupCacheStore'
import { musicbrainzLimiter } from './musicbrainzLimiter'
import { searchCandidates } from './searchQuery'

const BASE = 'https://musicbrainz.org/ws/2'
const RELEASE_PAGE = 'https://musicbrainz.org/release/'
const COVER_ART = 'https://coverartarchive.org/release/'
const COVER_ART_GROUP = 'https://coverartarchive.org/release-group/'

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
  disambiguation?: string
  status?: string
  'artist-credit'?: MbCredit[]
  'release-group'?: { id?: string; 'primary-type'?: string | null; 'secondary-types'?: string[] }
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

export interface MbReleaseSearch {
  count?: number
  releases?: MbReleaseSummary[]
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
  'release-group'?: { id?: string; 'primary-type'?: string | null; genres?: MbGenre[] }
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

function groupCoverUrl(groupId: string, size: 250 | 500): string {
  return `${COVER_ART_GROUP}${groupId}/front-${size}`
}

// The search JSON says nothing about cover art, so the thumbnail is a Cover Art Archive URL
// on faith. The album's (release group's) cover rather than the edition's: many editions
// have no art of their own (La Morta!'s 2006 CD answered 404 while its 2020 edition had
// one), and the group's exists whenever any edition does. A miss still shows the empty
// slot, which costs less than a request per row to ask first.
function releaseRow(release: MbReleaseSummary, fallbackCredit?: MbCredit[]): SearchResult {
  const artist = creditText(release['artist-credit'] ?? fallbackCredit)
  const formats = [
    ...new Set((release.media ?? []).map((m) => m.format).filter((f): f is string => !!f)),
  ]
  if (release['release-group']?.['secondary-types']?.includes('Compilation'))
    formats.push('Compilation')
  const year = release.date?.match(/^(\d{4})/)?.[1]
  const group = release['release-group']?.id
  // Every edition shares the album's title; the disambiguation ("special edition", "dutch
  // pressing") is how MusicBrainz tells them apart, and how its own pages list them.
  const title = release.disambiguation
    ? `${release.title} (${release.disambiguation})`
    : release.title
  return {
    provider: 'musicbrainz',
    id: numericIdOf(release.id),
    title: artist ? `${artist} - ${title}` : title,
    ...(year ? { year } : {}),
    ...(release.country ? { country: release.country } : {}),
    ...(formats.length ? { format: formats } : {}),
    thumb: group ? groupCoverUrl(group, 250) : coverUrl(release.id, 250),
    cover_image: group ? groupCoverUrl(group, 500) : coverUrl(release.id, 500),
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
      out.push(releaseRow(release, recording['artist-credit']))
    }
  }
  return out
}

// The Settings filter speaks Discogs' four buckets; MusicBrainz names each medium
// precisely. `name` sorts its media names into a bucket, `field` is the bucket on the
// index's format field: one lowercase keyword per medium ('12" vinyl', '8cm cd'), so a
// suffix wildcard reaches every size and variant.
const FORMAT_BUCKETS: Record<string, { name: RegExp; field: string }> = {
  Vinyl: { name: /vinyl/i, field: '*vinyl' },
  CD: { name: /\b(HD)?CD\b/, field: '*cd' },
  File: { name: /^Digital Media$/, field: '"digital media"' },
  Cassette: { name: /^Cassette$/, field: 'cassette' },
}

export function matchesMbFormats(row: SearchResult, formats: string[]): boolean {
  if (formats.length === 0) return true
  return formats.some((f) => row.format?.some((name) => FORMAT_BUCKETS[f]?.name.test(name)))
}

function formatClause(formats: string[], join = ' AND '): string {
  const fields = formats.flatMap((f) => FORMAT_BUCKETS[f]?.field ?? [])
  return fields.length ? `${join}format:(${fields.join(' OR ')})` : ''
}

// What the album tag says in brackets ("Deluxe Edition" of "Duran Duran (Deluxe Edition)"):
// the edition MusicBrainz writes in the release's disambiguation, not in its title.
function editionOf(album: string): string {
  return [...album.matchAll(/[([]([^)\]]*)[)\]]/g)]
    .map((m) => m[1].trim())
    .filter(Boolean)
    .join(' ')
}

const cacheStore = createLookupCacheStore<SearchResult[], Release>('musicbrainz-lookup-cache-v2')

// Free text goes in dismax mode: plain Lucene text only searches the recording title, so
// "Kings Of Tomorrow Finally" brought songs titled "Kings of Tomorrow" by anyone, while
// dismax spreads the words over title, artist and release. The fielded queries name their
// own fields and stay plain Lucene. The two modes answer differently, hence their own keys.
export async function searchOnce(
  query: string,
  priority?: SearchPriority,
  dismax = false,
): Promise<SearchResult[]> {
  const key = `${dismax ? 'dx' : 'q'}:${query.trim().toLowerCase()}`
  const cached = cachedSearch(cacheStore, key)
  if (cached) return cached
  const mode = dismax ? '&dismax=true' : ''
  const data = await api<MbRecordingSearch>(
    `${BASE}/recording?query=${encodeURIComponent(query)}${mode}&fmt=json&limit=25`,
    priority,
  )
  const results = groupByRelease(data.recordings ?? [])
  cacheIfUsable(cacheStore, key, results)
  return results
}

// The release index, asked for an album: "Search by album first", or free text typed
// without the track's tags. Cached under its own `rel:` prefix so a release query and a
// recording query of the same text never share an entry.
async function searchReleases(
  query: string,
  priority?: SearchPriority,
  dismax = false,
): Promise<SearchResult[]> {
  const key = `rel${dismax ? 'dx' : ''}:${query.trim().toLowerCase()}`
  const cached = cachedSearch(cacheStore, key)
  if (cached) return cached
  const mode = dismax ? '&dismax=true' : ''
  const data = await api<MbReleaseSearch>(
    `${BASE}/release?query=${encodeURIComponent(query)}${mode}&fmt=json&limit=25`,
    priority,
  )
  const results = (data.releases ?? []).map((release) => releaseRow(release))
  cacheIfUsable(cacheStore, key, results)
  return results
}

// "Search by album first" comes before everything, like on Discogs: the tagged album is the
// release's own title, so it goes on the release index's title field, pinned to the artist
// (an album name alone matches anyone's release, and a hit here ends the search). The album
// hint only arrives while the setting is on or the user typed it. An edition the tag spells
// in brackets is retried bare, the title MusicBrainz lists, with the edition kept as an
// optional match on the disambiguation so it scores first; nothing found falls through.
//
// With artist and title from the tags, a fielded recording query is far more precise than
// free text. Compilations are excluded on the first try because a dance track sits on
// hundreds of them and they fill every slot before the original single; they come back on
// the second try for a track that only ever came out on one. Messy tags miss both, so the
// free-text candidate ladder the other sources walk is the last resort, over the recording
// index too: a file is a recording, and release titles only name the track on a single.
// Free text with no artist was typed without the track's tags and names an album as often
// as a song, so the release index answers first there and the recordings follow.
// Every rung is one second of the rate limit, which is why the ladder stops at the first
// rung that finds anything in the chosen formats.
export async function search(
  query: string,
  priority?: SearchPriority,
  hints: SearchHints = {},
  formats: string[] = [],
): Promise<SearchResult[]> {
  const wanted = (rows: SearchResult[]): SearchResult[] =>
    rows.filter((row) => matchesMbFormats(row, formats))
  const clause = formatClause(formats)
  return activity.track(
    'musicbrainz',
    'activity.searchMusicbrainz',
    async () => {
      const artist = hints.artist?.trim()
      const title = hints.title?.trim()
      const album = hints.album?.trim()
      if (artist && album) {
        const pinned = `artist:"${escapeLucene(artist)}"`
        const asTagged = `release:"${escapeLucene(album)}" AND ${pinned}${clause}`
        const queries = [asTagged]
        const bare = bareAlbumTitle(album)
        if (bare !== album) {
          const edition = editionOf(album)
          queries.push(
            `+release:"${escapeLucene(bare)}" +${pinned}${formatClause(formats, ' +')}` +
              (edition ? ` comment:(${escapeLucene(edition)})` : ''),
          )
        }
        for (const query of queries) {
          const byAlbum = wanted(await searchReleases(query, priority))
          if (byAlbum.length) return byAlbum
        }
      }
      if (artist && title) {
        const fielded = `recording:"${escapeLucene(title)}" AND artist:"${escapeLucene(artist)}"`
        for (const q of [`${fielded} AND NOT secondarytype:compilation`, fielded]) {
          const results = wanted(await searchOnce(`${q}${clause}`, priority))
          if (results.length) return results
        }
      }
      // The album was already asked on the release index above; as a free-text candidate
      // against recordings it would only match tracks that happen to share its name.
      return searchCandidates(query, { ...hints, album: undefined }, async (candidate) => {
        const recordings = (): Promise<SearchResult[]> =>
          searchOnce(escapeLucene(candidate), priority, true)
        if (artist) return wanted(await recordings())
        const releases = await searchReleases(escapeLucene(candidate), priority, true)
        const ids = new Set(releases.map((r) => r.id))
        return wanted([...releases, ...(await recordings()).filter((r) => !ids.has(r.id))])
      })
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

// An edition without art of its own falls back to its album's cover, asked first with a
// two-byte Range probe: offering a URL that answers 404 would make applying the match fail
// its download. Anything but a success (a miss, archive.org's intermittent 500s, a timeout)
// counts as no cover.
async function coverExists(url: string): Promise<boolean> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-1' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }).catch(() => undefined)
  return res?.ok === true
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
      const group = data['release-group']?.id
      if (!release.images && group && (await coverExists(groupCoverUrl(group, 500)))) {
        const cover = groupCoverUrl(group, 500)
        release.images = [{ uri: cover, type: 'primary', resource_url: cover }]
      }
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
