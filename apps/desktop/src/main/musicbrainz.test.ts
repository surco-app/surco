import { afterEach, describe, expect, it, vi } from 'vitest'

// Every call paces through the shared limiter; mock it to a no-op so these unit tests
// don't wait a real second between requests.
vi.mock('./musicbrainzLimiter', () => ({ musicbrainzLimiter: { acquire: vi.fn() } }))

const { mbCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { mbCacheDir: mkdtempSync(join(tmpdir(), 'surco-musicbrainz-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => mbCacheDir, on: () => {} } }))

import { EMPTY_SEARCH_TTL_MS } from './lookupCacheStore'
import {
  escapeLucene,
  getRelease,
  groupByRelease,
  mapRelease,
  matchesMbFormats,
  numericIdOf,
  search,
} from './musicbrainz'
import {
  albumReleaseSearch,
  compilationHits,
  finallySingle,
  lifestyleDoubleCd,
  recordingSearch,
} from './musicbrainzFixture'

const SINGLE = '4a27f230-ab38-4fae-8dd7-c5032fd4a4ee'
const DOUBLE_CD = '87fabea0-0056-462d-ac7d-9ba3150d6028'
const SINGLE_GROUP = 'a07a80ad-20fb-3c74-a406-d6c2efb16856'
const DOUBLE_CD_GROUP = '8c23b838-adc4-313f-afc5-95488680926f'
const pageOf = (mbid: string): string => `https://musicbrainz.org/release/${mbid}`

function mockFetch(bodies: unknown[], status = 200): ReturnType<typeof vi.fn> {
  let call = 0
  const fn = vi.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => bodies[Math.min(call++, bodies.length - 1)],
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

function queryOf(url: unknown): string {
  return new URL(String(url)).searchParams.get('query') ?? ''
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('numericIdOf', () => {
  // SearchResult.id is a number while a MusicBrainz release is a UUID. The renderer keys
  // rows, the open release and the suggestion on `provider:id`, so two releases must never
  // share an id and the same release must always get the same one, across relaunches.
  it('derives a stable, distinct safe integer from each MBID', () => {
    expect(numericIdOf(SINGLE)).toBe(numericIdOf(SINGLE))
    expect(numericIdOf(SINGLE)).not.toBe(numericIdOf(DOUBLE_CD))
    expect(Number.isSafeInteger(numericIdOf(SINGLE))).toBe(true)
  })
})

describe('escapeLucene', () => {
  // A tag's own punctuation ("AC/DC", "Finally (Kosmic dub)", "Don't Stop!") would
  // otherwise be read as query syntax: MusicBrainz answers a 400 or matches nonsense.
  it('escapes every Lucene special character so tag text is searched literally', () => {
    expect(escapeLucene('AC/DC')).toBe('AC\\/DC')
    expect(escapeLucene('Finally (Kosmic dub)')).toBe('Finally \\(Kosmic dub\\)')
    expect(escapeLucene('say "hi" + bye: now!')).toBe('say \\"hi\\" \\+ bye\\: now\\!')
    expect(escapeLucene('a && b || c ~ d^2 * e? [f] {g} \\')).toBe(
      'a \\&& b \\|| c \\~ d\\^2 \\* e\\? \\[f\\] \\{g\\} \\\\',
    )
  })
})

describe('groupByRelease', () => {
  // A recording search answers with tracks; the results column lists releases, so every
  // release a hit appears on becomes one row, deduped across hits and kept in MusicBrainz'
  // relevance order by first appearance.
  it('lists each release once, in first-appearance order', () => {
    const rows = groupByRelease(recordingSearch.recordings ?? [])
    expect(rows.map((r) => r.releaseUrl)).toEqual([
      pageOf('07bb9a01-5887-40d4-b292-45d418de4fa6'),
      pageOf('9a1cb24a-171b-40b9-8218-1dfd014e0561'),
      pageOf(DOUBLE_CD),
      pageOf('0c4dbc1a-3dfa-46d2-ad25-03af27c70a90'),
      pageOf(SINGLE),
      pageOf('b7dd461f-feba-4006-b976-724c7b7fb8a8'),
    ])
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })

  // The row carries what separates two pressings of the same single at a glance (year,
  // country, medium) and the credit joined the way MusicBrainz writes it.
  // The thumbnail is the album's (release group's) cover, not this edition's: the search JSON
  // cannot say whether an edition has its own art, and many do not (La Morta!'s 2006 CD
  // answered 404 while its 2020 digital edition, same group, has one). The group's cover
  // exists whenever any edition has art, at no extra request.
  it('builds the row from the release credit, date, country, medium and album cover', () => {
    const row = groupByRelease(recordingSearch.recordings ?? []).find(
      (r) => r.releaseUrl === pageOf(SINGLE),
    )
    expect(row).toEqual({
      provider: 'musicbrainz',
      id: numericIdOf(SINGLE),
      title:
        'Kings of Tomorrow feat. Julie McKnight - Finally (Includes Original & Kevin Yost Remixes)',
      year: '2001',
      country: 'XW',
      format: ['Digital Media'],
      thumb: `https://coverartarchive.org/release-group/${SINGLE_GROUP}/front-250`,
      cover_image: `https://coverartarchive.org/release-group/${SINGLE_GROUP}/front-500`,
      releaseUrl: pageOf(SINGLE),
    })
  })

  // The renderer's pre-rank sinks rows whose format says "Compilation"; carrying the
  // release group's secondary type there is what keeps a DJ-mix CD from burying the
  // artist's own single, the dominant noise for any dance track on MusicBrainz.
  it('marks compilation releases so the pre-rank can sink them', () => {
    const [row] = groupByRelease(compilationHits)
    expect(row.title).toBe('Various Artists - Ministry of Sound: The Annual 2002')
    expect(row.format).toEqual(['CD', 'Compilation'])
  })
})

describe('mapRelease', () => {
  it('maps a single with its credit, label, genres, durations and front cover', () => {
    const rel = mapRelease(finallySingle)
    expect(rel).toMatchObject({
      provider: 'musicbrainz',
      id: numericIdOf(SINGLE),
      title: 'Finally (Includes Original & Kevin Yost Remixes)',
      artists: [{ name: 'Kings of Tomorrow' }, { name: 'Julie McKnight' }],
      year: 2001,
      released: '2001-04-02',
      country: 'XW',
      labels: [{ name: 'Distance', catno: '' }],
      uri: pageOf(SINGLE),
      images: [
        {
          uri: `https://coverartarchive.org/release/${SINGLE}/front-500`,
          type: 'primary',
          resource_url: `https://coverartarchive.org/release/${SINGLE}/front-500`,
        },
      ],
    })
    // The release's own genre list is empty here; the release group's is what MusicBrainz
    // users actually tag, strongest first.
    expect(rel.genres).toEqual(['deep house', 'electronic', 'house'])
    expect(rel.tracklist[0]).toEqual({
      position: '1',
      title: 'Finally',
      artists: [{ name: 'Kings of Tomorrow' }, { name: 'Julie McKnight' }],
      duration: '5:35',
    })
  })

  // Positions follow Discogs' "disc-track" form, the one splitPosition reads back into
  // disc and track number: without the disc, track 1 of CD2 would tag as track 1 of CD1.
  it('numbers a multi-disc release as disc-track', () => {
    const rel = mapRelease(lifestyleDoubleCd)
    expect(rel.tracklist.map((t) => t.position)).toEqual(['1-1', '1-2', '2-1', '2-2'])
    expect(rel.labels).toEqual([{ name: 'Distance', catno: 'Di 2022' }])
  })

  // Cover Art Archive answers 404 for a release without art; offering that URL as the
  // cover would make applying the match fail its download.
  it('offers no cover when the Cover Art Archive has no front image', () => {
    expect(mapRelease(lifestyleDoubleCd).images).toBeUndefined()
  })
})

describe('search', () => {
  // With artist and title from the tags, a fielded recording query is far more precise
  // than free text; compilations are excluded first because a dance track appears on
  // hundreds of them and they would fill all 25 slots before the original single.
  it('asks for the recording by title and artist, compilations excluded, first', async () => {
    const fn = mockFetch([recordingSearch])
    const rows = await search('Kings Of Tomorrow - Finally', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally',
    })
    expect(rows).toHaveLength(6)
    expect(fn).toHaveBeenCalledTimes(1)
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/musicbrainz\.org\/ws\/2\/recording\?/)
    expect(queryOf(url)).toBe(
      'recording:"Finally" AND artist:"Kings Of Tomorrow" AND NOT secondarytype:compilation',
    )
    expect(new Headers(init.headers).get('User-Agent')).toMatch(/Surco\/.+https:\/\//)
  })

  // A track that only ever came out on compilations must still be found.
  it('lets compilations back in when excluding them left nothing', async () => {
    const fn = mockFetch([
      { count: 0, recordings: [] },
      { count: 1, recordings: compilationHits },
    ])
    const rows = await search('Kings Of Tomorrow - Finally (comp)', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally (comp)',
    })
    expect(rows).toHaveLength(1)
    expect(queryOf(fn.mock.calls[1][0])).toBe(
      'recording:"Finally \\(comp\\)" AND artist:"Kings Of Tomorrow"',
    )
  })

  // Messy tags (a filename-derived artist, a title with junk) miss the fielded query;
  // the same cleaned candidate ladder the other sources walk is the fallback, escaped.
  it('falls back to the free-text ladder when the fielded query finds nothing', async () => {
    const fn = mockFetch([
      { count: 0, recordings: [] },
      { count: 0, recordings: [] },
      recordingSearch,
    ])
    const rows = await search('kings of tomorrow finally', 'high', {
      artist: 'Julie McKnight',
      title: 'Finally',
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(fn).toHaveBeenCalledTimes(3)
    expect(queryOf(fn.mock.calls[2][0])).toBe('kings of tomorrow finally')
  })

  // Plain Lucene text only searches the recording title, so "Kings Of Tomorrow Finally"
  // brought songs titled "Kings of Tomorrow" by anyone (measured 28/09, the panel showed
  // Jewel and Wild Honey). dismax spreads the text over title, artist and release; the
  // fielded queries above name their own fields and must stay plain Lucene.
  it('asks free text in dismax mode so the words also match artist and release', async () => {
    const fn = mockFetch([
      { count: 0, recordings: [] },
      { count: 0, recordings: [] },
      recordingSearch,
    ])
    await search('Kings Of Tomorrow Finally dismax', 'high', {
      artist: 'K.O.T.',
      title: 'Finally',
    })
    const dismaxOf = (url: unknown): string | null =>
      new URL(String(url)).searchParams.get('dismax')
    expect(dismaxOf(fn.mock.calls[0][0])).toBeNull()
    expect(dismaxOf(fn.mock.calls[1][0])).toBeNull()
    expect(dismaxOf(fn.mock.calls[2][0])).toBe('true')
  })

  it('searches free text straight away when the tags name no artist', async () => {
    const fn = mockFetch([recordingSearch])
    await search('Finally (Kosmic dub)', 'high', {})
    expect(queryOf(fn.mock.calls[0][0])).toBe('Finally \\(Kosmic dub\\)')
  })

  // Same rule as every provider: an empty answer is not remembered on disk, since it
  // cannot be told apart from a failure and would leave the track unmatchable for good.
  it('asks the network again after an empty answer once the short memory expires', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    mockFetch([{ count: 0, recordings: [] }])
    await search('nada de nada xyz', 'high', {})
    vi.advanceTimersByTime(EMPTY_SEARCH_TTL_MS)
    const second = mockFetch([recordingSearch])
    const rows = await search('nada de nada xyz', 'high', {})
    expect(second).toHaveBeenCalled()
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('search by album first', () => {
  const LIFESTYLE = 'It’s in the Lifestyle'
  const pathOf = (url: unknown): string => new URL(String(url)).pathname

  // The tagged album is the release's own title, so with the setting on (the only time the
  // album hint arrives) the release index is asked first, on its title and artist fields:
  // the file's own album leads instead of every single and DJ mix that carries the track.
  it('asks the release index for the tagged album and artist before any recording query', async () => {
    const fn = mockFetch([albumReleaseSearch])
    const rows = await search('Kings Of Tomorrow - Finally', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally',
      album: LIFESTYLE,
    })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(pathOf(fn.mock.calls[0][0])).toBe('/ws/2/release')
    expect(queryOf(fn.mock.calls[0][0])).toBe(
      `release:"${LIFESTYLE}" AND artist:"Kings Of Tomorrow"`,
    )
    expect(rows.map((r) => r.releaseUrl)).toEqual([
      pageOf('2e84bec2-c062-411f-bec2-c0aefc0073b2'),
      pageOf(DOUBLE_CD),
      pageOf('64ceaf0c-4c94-4811-a01c-bbf066172f0e'),
    ])
    expect(rows[1]).toMatchObject({
      provider: 'musicbrainz',
      id: numericIdOf(DOUBLE_CD),
      title: `Kings of Tomorrow - ${LIFESTYLE}`,
      year: '2001',
      country: 'XE',
      format: ['CD'],
    })
  })

  // A mistyped or foreign album tag finds nothing; the track search must then run exactly
  // as it does with the setting off.
  it('falls back to the recording ladder when the album is not found', async () => {
    const fn = mockFetch([{ count: 0, releases: [] }, recordingSearch])
    const rows = await search('Kings Of Tomorrow - Finally Again', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally Again',
      album: 'Album que no existe',
    })
    expect(rows.length).toBeGreaterThan(0)
    expect(pathOf(fn.mock.calls[1][0])).toBe('/ws/2/recording')
    expect(queryOf(fn.mock.calls[1][0])).toBe(
      'recording:"Finally Again" AND artist:"Kings Of Tomorrow" AND NOT secondarytype:compilation',
    )
  })

  // Off by default: without the album hint no release query is spent, so every request
  // (each one a second of MusicBrainz' rate limit) is the same as before the setting.
  it('never asks the release index when no album hint arrives', async () => {
    const fn = mockFetch([
      { count: 0, recordings: [] },
      { count: 0, recordings: [] },
      recordingSearch,
    ])
    await search('kot finally album off', 'high', {
      artist: 'Kings Of Tomorrow',
      title: 'Finally Off',
    })
    expect(fn.mock.calls.map(([url]) => pathOf(url))).toEqual([
      '/ws/2/recording',
      '/ws/2/recording',
      '/ws/2/recording',
    ])
  })

  // An album name alone matches anyone's release, and a hit ends the search.
  it('skips the album query when the tags name no artist', async () => {
    const fn = mockFetch([recordingSearch])
    await search('lifestyle no artist', 'high', { title: 'Finally Lone', album: LIFESTYLE })
    expect(pathOf(fn.mock.calls[0][0])).toBe('/ws/2/recording')
  })
})

describe('matchesMbFormats', () => {
  const rowOf = (...format: string[]) =>
    groupByRelease([
      {
        id: 'r',
        title: 't',
        releases: [{ id: 'x', title: 't', media: format.map((f) => ({ format: f })) }],
      },
    ])[0]

  // The Settings filter speaks Discogs' four buckets while MusicBrainz names every medium
  // precisely ('12" Vinyl', '8cm CD', 'Digital Media'), so each name has to land in the
  // bucket a user means: a 7" is vinyl, an SHM-CD is a CD, a "Digital Media" is a file.
  it.each([
    ['Vinyl', '12" Vinyl'],
    ['Vinyl', '7" Vinyl'],
    ['Vinyl', 'Vinyl'],
    ['CD', 'CD'],
    ['CD', '8cm CD'],
    ['CD', 'SHM-CD'],
    ['CD', 'HDCD'],
    ['CD', 'Enhanced CD'],
    ['CD', 'CD-R'],
    ['File', 'Digital Media'],
    ['Cassette', 'Cassette'],
  ])('puts %s around a %s release', (bucket, format) => {
    expect(matchesMbFormats(rowOf(format), [bucket])).toBe(true)
  })

  // Look-alike names that are other media: an SACD or a VCD will not play as the CD the
  // user asked for, and a microcassette is not a cassette deck's tape.
  it.each([
    ['CD', 'SACD'],
    ['CD', 'VCD'],
    ['Cassette', 'Microcassette'],
    ['Vinyl', 'Digital Media'],
  ])('keeps %s away from a %s release', (bucket, format) => {
    expect(matchesMbFormats(rowOf(format), [bucket])).toBe(false)
  })

  // A vinyl + CD box answers either choice; a release with no medium named answers none,
  // as on Discogs, since nothing says it is the format asked for.
  it('accepts a release when any medium fits and rejects one with no medium named', () => {
    expect(matchesMbFormats(rowOf('CD', '12" Vinyl'), ['Vinyl'])).toBe(true)
    expect(matchesMbFormats(rowOf(), ['Vinyl'])).toBe(false)
    expect(matchesMbFormats(rowOf(), [])).toBe(true)
  })
})

describe('search with a format filter', () => {
  const VINYL = 'b7dd461f-feba-4006-b976-724c7b7fb8a8'

  // The recording index matches a format on any release of a recording, so asking for it
  // picks recordings that came out on vinyl (measured 01/10: "Finally" showed no vinyl in
  // its first 28 releases unfiltered, 6 with format:*vinyl). The field is one lowercase
  // keyword ('12" vinyl'), hence the leading wildcard. Each recording still lists all its
  // releases, so the rows are thinned to the chosen formats as well.
  it('asks the recording index for the formats and keeps only releases in them', async () => {
    const fn = mockFetch([recordingSearch])
    const rows = await search(
      'Kings Of Tomorrow - Finally vinyl',
      'high',
      {
        artist: 'Kings Of Tomorrow',
        title: 'Finally vinyl',
      },
      ['Vinyl', 'File'],
    )
    expect(queryOf(fn.mock.calls[0][0])).toBe(
      'recording:"Finally vinyl" AND artist:"Kings Of Tomorrow" AND NOT secondarytype:compilation AND format:(*vinyl OR "digital media")',
    )
    expect(rows.map((r) => r.format)).toEqual([
      ['Digital Media'],
      ['Digital Media'],
      ['Digital Media'],
      ['12" Vinyl'],
    ])
    expect(rows.at(-1)?.releaseUrl).toBe(pageOf(VINYL))
  })

  // A rung whose releases all fall outside the filter found nothing the user can use, so
  // the ladder goes on to the next rung exactly as after an empty answer.
  it('moves to the next rung when no release of a rung is in the chosen formats', async () => {
    const fn = mockFetch([recordingSearch, { count: 1, recordings: compilationHits }])
    const rows = await search(
      'Kings Of Tomorrow - Finally cassette',
      'high',
      {
        artist: 'Kings Of Tomorrow',
        title: 'Finally cassette',
      },
      ['CD'],
    )
    expect(fn).toHaveBeenCalledTimes(1)
    expect(rows.every((r) => r.format?.includes('CD'))).toBe(true)
    const fn2 = mockFetch([recordingSearch, { count: 1, recordings: compilationHits }])
    await search(
      'Kings Of Tomorrow - Finally tape',
      'high',
      {
        artist: 'Kings Of Tomorrow',
        title: 'Finally tape',
      },
      ['Cassette'],
    )
    expect(queryOf(fn2.mock.calls[1][0])).toBe(
      'recording:"Finally tape" AND artist:"Kings Of Tomorrow" AND format:(cassette)',
    )
  })

  // "Search by album first" asks the release index, which has the same format field.
  it('asks the release index for the formats when searching by album', async () => {
    const fn = mockFetch([albumReleaseSearch])
    const rows = await search(
      'Kings Of Tomorrow - Finally',
      'high',
      {
        artist: 'Kings Of Tomorrow',
        title: 'Finally',
        album: 'Lifestyle by format',
      },
      ['File'],
    )
    expect(queryOf(fn.mock.calls[0][0])).toBe(
      'release:"Lifestyle by format" AND artist:"Kings Of Tomorrow" AND format:("digital media")',
    )
    expect(rows.map((r) => r.releaseUrl)).toEqual([pageOf('64ceaf0c-4c94-4811-a01c-bbf066172f0e')])
  })

  // Free text runs in dismax mode, which reads no Lucene fields, so the filter there can
  // only thin the rows.
  it('thins the free-text rows without adding a field the dismax query cannot read', async () => {
    const fn = mockFetch([recordingSearch])
    const rows = await search('Finally free vinyl', 'high', {}, ['Vinyl'])
    expect(queryOf(fn.mock.calls[0][0])).toBe('Finally free vinyl')
    expect(rows.map((r) => r.releaseUrl)).toEqual([pageOf(VINYL)])
  })
})

describe('getRelease', () => {
  // The row's releaseUrl is what fetchRelease hands back, so the client must accept the
  // page URL and look the release up by the MBID inside it.
  it('looks up the release named by the page URL with tracks, credits, labels and genres', async () => {
    const fn = mockFetch([finallySingle])
    const rel = await getRelease(pageOf(SINGLE))
    expect(rel.title).toBe('Finally (Includes Original & Kevin Yost Remixes)')
    const url = new URL(String(fn.mock.calls[0][0]))
    expect(`${url.origin}${url.pathname}`).toBe(`https://musicbrainz.org/ws/2/release/${SINGLE}`)
    expect(url.searchParams.get('inc')).toBe(
      'recordings artist-credits labels genres release-groups',
    )
  })

  it('serves a repeated release from the cache without refetching', async () => {
    const fn = mockFetch([lifestyleDoubleCd])
    await getRelease(pageOf(DOUBLE_CD))
    await getRelease(pageOf(DOUBLE_CD))
    const lookups = fn.mock.calls.filter(([url]) =>
      String(url).startsWith('https://musicbrainz.org/'),
    )
    expect(lookups).toHaveLength(1)
  })

  // The ref crosses IPC from the renderer; anything but a MusicBrainz release must not
  // be spliced into a request path.
  // An edition without its own art still belongs to an album that may have one (the 2006
  // CD of La Morta! showed no cover while its 2020 edition had it). The group's cover is
  // asked with a two-byte Range probe so applying the match never downloads a 404.
  it('takes the album cover when the release has no art of its own', async () => {
    const fn = vi.fn(async (url: string) =>
      url.startsWith('https://coverartarchive.org/')
        ? { status: 206, ok: true, json: async () => ({}) }
        : {
            status: 200,
            ok: true,
            json: async () => ({
              ...lifestyleDoubleCd,
              id: '87fabea0-0056-462d-ac7d-9ba3150d6030',
            }),
          },
    )
    vi.stubGlobal('fetch', fn)
    const rel = await getRelease(pageOf('87fabea0-0056-462d-ac7d-9ba3150d6030'), 'high')
    const cover = `https://coverartarchive.org/release-group/${DOUBLE_CD_GROUP}/front-500`
    expect(rel.images).toEqual([{ uri: cover, type: 'primary', resource_url: cover }])
    const probe = fn.mock.calls.find(([url]) =>
      String(url).startsWith('https://coverartarchive.org/'),
    )
    expect(probe?.[0]).toBe(cover)
  })

  it('offers no cover when neither the release nor its album has art', async () => {
    const other = { ...lifestyleDoubleCd, id: '87fabea0-0056-462d-ac7d-9ba3150d6029' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('https://coverartarchive.org/')
          ? { status: 404, ok: false, json: async () => ({}) }
          : { status: 200, ok: true, json: async () => other },
      ),
    )
    const rel = await getRelease(pageOf(other.id), 'high')
    expect(rel.images).toBeUndefined()
  })

  it('refuses a ref that is not a MusicBrainz release without fetching', async () => {
    const fn = mockFetch([finallySingle])
    await expect(getRelease('https://evil.example/../../x')).rejects.toThrow(
      /^SURCO_ERR:musicbrainzUnavailable/,
    )
    expect(fn).not.toHaveBeenCalled()
  })
})

// MusicBrainz answers 503 when a client goes over its one request per second, and keeps
// answering it to a client that ignores the signal until the IP is blocked.
describe('rate limiting and failures', () => {
  it('backs off and retries a 503, then succeeds', async () => {
    vi.useFakeTimers()
    let call = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        call++ === 0
          ? { status: 503, ok: false, json: async () => ({}) }
          : { status: 200, ok: true, json: async () => recordingSearch },
      ),
    )
    const p = search('retry after 503 query', 'high', {})
    await vi.runAllTimersAsync()
    expect((await p).length).toBeGreaterThan(0)
  })

  it('gives up with the translated rate-limit key after bounded retries', async () => {
    vi.useFakeTimers()
    const fn = mockFetch([{}], 503)
    const p = search('always 503 query', 'high', {})
    const settled = expect(p).rejects.toThrow(/^SURCO_ERR:musicbrainzRateLimit/)
    await vi.runAllTimersAsync()
    await settled
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('stamps the unavailable key on any other HTTP error', async () => {
    mockFetch([{}], 500)
    await expect(search('mb 500 query')).rejects.toThrow(/^SURCO_ERR:musicbrainzUnavailable/)
  })

  it('stamps the unavailable key when the connection drops', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(search('mb offline query')).rejects.toThrow(/^SURCO_ERR:musicbrainzUnavailable/)
  })
})
