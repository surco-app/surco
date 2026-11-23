import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./itunesLimiter', () => ({ itunesLimiter: { acquire: vi.fn() } }))

const { itunesCacheDir, locale } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return {
    itunesCacheDir: mkdtempSync(join(tmpdir(), 'surco-itunes-cache-')),
    locale: { country: 'es' },
  }
})
vi.mock('electron', () => ({
  app: { getPath: () => itunesCacheDir, on: () => {}, getLocaleCountryCode: () => locale.country },
}))

import { activity } from './activity'
import { getRelease, groupByAlbum, hitsNamingEveryWord, mapRelease, search } from './itunes'

const ART = 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/cover.jpg'

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

function mockStatuses(statuses: number[], body: unknown): ReturnType<typeof vi.fn> {
  let call = 0
  const fn = vi.fn(async () => {
    const status = statuses[Math.min(call++, statuses.length - 1)]
    return { status, ok: status >= 200 && status < 300, json: async () => body }
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockStores(byCountry: Record<string, unknown>): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (url: string) => ({
    status: 200,
    ok: true,
    json: async () =>
      byCountry[new URL(url).searchParams.get('country') ?? ''] ?? { resultCount: 0, results: [] },
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const reviveHit = {
  artistName: 'Revive DJs',
  trackName: 'Not So Bad (Radio Edit)',
  collectionId: 6797715483,
  collectionName: 'Not So Bad - EP',
  artworkUrl100: `${ART}/100x100bb.jpg`,
  trackTimeMillis: 243217,
  releaseDate: '2026-09-11T12:00:00Z',
  primaryGenreName: 'Dance',
}
const guettaHit = {
  artistName: 'David Guetta & Showtek',
  trackName: 'Bad (feat. Vassy) [Radio Edit]',
  collectionId: 111,
  collectionName: 'Bad (feat. Vassy) [Radio Edit] - Single',
  artworkUrl100: `${ART}/100x100bb.jpg`,
  releaseDate: '2014-03-17T12:00:00Z',
}
const jacksonHit = {
  artistName: 'Michael Jackson',
  trackName: 'Bad',
  collectionId: 222,
  collectionName: 'Bad',
  artworkUrl100: `${ART}/100x100bb.jpg`,
  releaseDate: '1987-08-31T07:00:00Z',
}

const reviveLookup = {
  resultCount: 5,
  results: [
    {
      wrapperType: 'collection',
      collectionId: 6797715483,
      artistName: 'Revive DJs',
      collectionName: 'Not So Bad - EP',
      copyright: '℗ 2026 Plus Records',
      releaseDate: '2026-09-11T07:00:00Z',
      primaryGenreName: 'Dance',
      artworkUrl100: `${ART}/100x100bb.jpg`,
      collectionViewUrl: 'https://music.apple.com/es/album/not-so-bad-ep/6797715483?uo=4',
    },
    {
      wrapperType: 'track',
      trackNumber: 3,
      discNumber: 1,
      discCount: 1,
      trackName: 'Not So Bad (Fitzer Remix)',
      artistName: 'Revive DJs',
      trackTimeMillis: 359908,
    },
    {
      wrapperType: 'track',
      trackNumber: 1,
      discNumber: 1,
      discCount: 1,
      trackName: 'Not So Bad',
      artistName: 'Revive DJs',
      trackTimeMillis: 347621,
    },
    {
      wrapperType: 'track',
      trackNumber: 4,
      discNumber: 1,
      discCount: 1,
      trackName: 'Not So Bad (Fitzer Radio Edit)',
      artistName: 'Revive DJs & Fitzer',
      trackTimeMillis: 256017,
    },
    {
      wrapperType: 'track',
      trackNumber: 2,
      discNumber: 1,
      discCount: 1,
      trackName: 'Not So Bad (Radio Edit)',
      artistName: 'Revive DJs',
      trackTimeMillis: 243217,
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  locale.country = 'es'
})

describe('groupByAlbum', () => {
  it('lists one row per album in the order Apple ranked them, since the results column shows releases, not tracks', () => {
    const secondTrack = { ...reviveHit, trackName: 'Not So Bad (Fitzer Remix)' }
    expect(groupByAlbum([reviveHit, jacksonHit, secondTrack])).toEqual([
      {
        provider: 'itunes',
        id: 6797715483,
        title: 'Revive DJs - Not So Bad - EP',
        thumb: `${ART}/250x250bb.jpg`,
        cover_image: `${ART}/3000x3000bb.jpg`,
        year: '2026',
      },
      {
        provider: 'itunes',
        id: 222,
        title: 'Michael Jackson - Bad',
        thumb: `${ART}/250x250bb.jpg`,
        cover_image: `${ART}/3000x3000bb.jpg`,
        year: '1987',
      },
    ])
  })

  it('drops hits without a collection, which name no release that can be loaded', () => {
    expect(groupByAlbum([{ artistName: 'Nadie', trackName: 'Suelta' }])).toEqual([])
  })
})

describe('hitsNamingEveryWord', () => {
  it('keeps only the hits that carry every word of the query, because Apple ranks by popularity and buries the right release under famous homonyms', () => {
    expect(
      hitsNamingEveryWord('Not So Bad Radio Edit', [guettaHit, jacksonHit, reviveHit]),
    ).toEqual([reviveHit])
  })

  it('ignores case, accents and punctuation, so a tag spelled differently still finds the release', () => {
    const hit = {
      ...jacksonHit,
      artistName: 'Rosalía',
      trackName: 'DESPECHÁ',
      collectionName: 'MOTOMAMI +',
    }
    expect(hitsNamingEveryWord('rosalia despecha', [hit])).toEqual([hit])
  })

  it('matches whole words only, so "Bad" is not found inside "Badlands"', () => {
    const hit = { ...jacksonHit, trackName: 'Badlands', collectionName: 'Badlands' }
    expect(hitsNamingEveryWord('Michael Jackson Bad', [hit])).toEqual([])
  })
})

describe('search', () => {
  it('asks for songs, the full 200 rows and the system country, since the catalog and its order differ per store', async () => {
    const fetchMock = mockFetch([{ resultCount: 1, results: [reviveHit] }])
    await search('Not So Bad Radio Edit')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search')
    expect(url.searchParams.get('term')).toBe('Not So Bad Radio Edit')
    expect(url.searchParams.get('entity')).toBe('song')
    expect(url.searchParams.get('limit')).toBe('200')
    expect(url.searchParams.get('country')).toBe('ES')
  })

  it('falls back to the US store when the system names no country, so the search never goes out without a store', async () => {
    locale.country = ''
    const fetchMock = mockFetch([{ resultCount: 0, results: [] }])
    await search('sin pais xyz')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.searchParams.get('country')).toBe('US')
  })

  it('looks in the UK and then the US store when the system store has nothing, because singles like Darren Styles - Save Me are only sold in some stores', async () => {
    const fetchMock = mockStores({ US: { resultCount: 1, results: [reviveHit] } })
    const results = await search('Revive Bad Radio Edit')
    expect(results.map((r) => r.id)).toEqual([6797715483])
    const stores = fetchMock.mock.calls.map((c) =>
      new URL(c[0] as string).searchParams.get('country'),
    )
    expect(stores).toEqual(['ES', 'GB', 'US'])
  })

  it('prefers the exact version in another store over a looser query at home, because the mix in the title is what the user is looking for', async () => {
    const savemeHit = {
      artistName: 'Darren Styles',
      trackName: 'Save Me (Extended Club Mix)',
      collectionId: 1492464969,
      collectionName: 'Save Me',
    }
    const skydivinHit = {
      artistName: 'Darren Styles',
      trackName: 'Save Me',
      collectionId: 1426682480,
      collectionName: "Skydivin'",
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const params = new URL(url).searchParams
        const exact = params.get('term')?.includes('Extended Club Mix')
        const hits =
          params.get('country') === 'GB' ? [savemeHit, skydivinHit] : exact ? [] : [skydivinHit]
        return {
          status: 200,
          ok: true,
          json: async () => ({ resultCount: hits.length, results: hits }),
        }
      }),
    )
    const results = await search('Darren Styles - Save Me (Extended Club Mix)', 'high', {
      artist: 'Darren Styles',
      title: 'Save Me (Extended Club Mix)',
    })
    expect(results.map((r) => r.id)).toEqual([1492464969])
  })

  it('keeps to the system store when it already has the release, so the other stores cost no requests', async () => {
    const fetchMock = mockStores({
      ES: { resultCount: 1, results: [reviveHit] },
      GB: { resultCount: 1, results: [{ ...reviveHit, collectionId: 1 }] },
    })
    const results = await search('Revive So Bad EP')
    expect(results.map((r) => r.id)).toEqual([6797715483])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not ask the same store twice when the system store is one of the fallbacks', async () => {
    locale.country = 'gb'
    const fetchMock = mockStores({})
    await search('nada en ninguna tienda gb')
    const stores = fetchMock.mock.calls.map((c) =>
      new URL(c[0] as string).searchParams.get('country'),
    )
    expect(stores).toEqual(['GB', 'US'])
  })

  it('returns the one release whose hits name every word, out of a page full of homonyms', async () => {
    mockFetch([{ resultCount: 3, results: [guettaHit, jacksonHit, reviveHit] }])
    const results = await search('Not So Bad Radio Edit')
    expect(results.map((r) => r.id)).toEqual([6797715483])
  })

  it('comes back empty when no hit names every word, so the ladder tries its next candidate instead of offering homonyms', async () => {
    mockFetch([{ resultCount: 2, results: [guettaHit, jacksonHit] }])
    expect(await search('Not So Bad Club Mix')).toEqual([])
  })

  it('retries after a rate limit and returns the results, because Apple answers bursts with 403 instead of slowing down', async () => {
    vi.useFakeTimers()
    const fetchMock = mockStatuses([403, 429, 200], { resultCount: 1, results: [reviveHit] })
    const p = search('Revive DJs Not So Bad')
    await vi.runAllTimersAsync()
    const results = await p
    expect(results.map((r) => r.id)).toEqual([6797715483])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up with a translatable rate-limit key after the last retry, so the user knows to wait', async () => {
    vi.useFakeTimers()
    mockStatuses([403], {})
    const p = search('limited forever query')
    const assertion = expect(p).rejects.toThrow(/^SURCO_ERR:itunesRateLimit/)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('stamps a translatable key when Apple answers with another HTTP error', async () => {
    mockFetch([{}], 503)
    await expect(search('itunes down query')).rejects.toThrow(/^SURCO_ERR:itunesUnavailable/)
  })

  it('stamps the same key when the connection drops, instead of a raw fetch error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    await expect(search('itunes offline query')).rejects.toThrow(/^SURCO_ERR:itunesUnavailable/)
  })
})

describe('mapRelease', () => {
  it('maps the album lookup to a Release the scorer and the editor can use', () => {
    const rel = mapRelease(reviveLookup.results)
    expect(rel).toMatchObject({
      provider: 'itunes',
      id: 6797715483,
      title: 'Not So Bad - EP',
      artists: [{ name: 'Revive DJs' }],
      year: 2026,
      released: '2026-09-11',
      genres: ['Dance'],
      labels: [{ name: 'Plus Records', catno: '' }],
      images: [
        {
          uri: `${ART}/3000x3000bb.jpg`,
          type: 'primary',
          resource_url: `${ART}/3000x3000bb.jpg`,
        },
      ],
    })
  })

  it('orders the tracklist by disc and number with m:ss durations and each track artist, because the lookup does not promise any order', () => {
    expect(mapRelease(reviveLookup.results).tracklist).toEqual([
      { position: '1', artists: [{ name: 'Revive DJs' }], title: 'Not So Bad', duration: '5:48' },
      {
        position: '2',
        artists: [{ name: 'Revive DJs' }],
        title: 'Not So Bad (Radio Edit)',
        duration: '4:03',
      },
      {
        position: '3',
        artists: [{ name: 'Revive DJs' }],
        title: 'Not So Bad (Fitzer Remix)',
        duration: '6:00',
      },
      {
        position: '4',
        artists: [{ name: 'Revive DJs & Fitzer' }],
        title: 'Not So Bad (Fitzer Radio Edit)',
        duration: '4:16',
      },
    ])
  })

  it('prefixes the disc on a multi-disc album, so track 3 of disc 2 does not read as track 3 of disc 1', () => {
    const [collection] = reviveLookup.results
    const track = (discNumber: number, trackNumber: number) => ({
      wrapperType: 'track',
      trackNumber,
      discNumber,
      discCount: 2,
      trackName: `Pista ${discNumber}-${trackNumber}`,
      artistName: 'Revive DJs',
    })
    const rel = mapRelease([collection, track(2, 3), track(1, 1)])
    expect(rel.tracklist.map((t) => t.position)).toEqual(['1-1', '2-3'])
  })

  it('reads the label from the copyright without the symbols and year, and leaves it out when Apple gives none', () => {
    const [collection, ...tracks] = reviveLookup.results
    expect(
      mapRelease([{ ...collection, copyright: '© 2019 Defected Records Limited' }, ...tracks])
        .labels,
    ).toEqual([{ name: 'Defected Records Limited', catno: '' }])
    expect(mapRelease([{ ...collection, copyright: undefined }, ...tracks]).labels).toBeUndefined()
  })
})

describe('getRelease', () => {
  it('looks the album up in the system store and serves a repeat from the cache, so reopening a track spends no request', async () => {
    const fetchMock = mockFetch([reviveLookup])
    const rel = await getRelease(6797715483)
    expect(rel.title).toBe('Not So Bad - EP')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/lookup')
    expect(url.searchParams.get('id')).toBe('6797715483')
    expect(url.searchParams.get('entity')).toBe('song')
    expect(url.searchParams.get('country')).toBe('ES')
    await getRelease(6797715483)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails instead of caching an empty release when Apple returns no album, so a lookup hiccup does not hide the release for good', async () => {
    const empty = { resultCount: 0, results: [] }
    const fetchMock = mockFetch([empty, empty, empty, reviveLookup])
    await expect(getRelease(7)).rejects.toThrow(/^SURCO_ERR:itunesUnavailable/)
    const rel = await getRelease(7)
    expect(rel.title).toBe('Not So Bad - EP')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('loads an album sold only in another store from that store and links the row there, so a release found abroad opens instead of failing', async () => {
    const fetchMock = mockStores({
      GB: {
        ...reviveLookup,
        results: reviveLookup.results.map((r) => ({ ...r, collectionId: 43 })),
      },
    })
    const urls: (string | undefined)[] = []
    const off = activity.subscribe((e) => urls.push(e.url))
    try {
      const rel = await getRelease(43)
      expect(rel.title).toBe('Not So Bad - EP')
    } finally {
      off()
    }
    const stores = fetchMock.mock.calls.map((c) =>
      new URL(c[0] as string).searchParams.get('country'),
    )
    expect(stores).toEqual(['ES', 'GB'])
    expect(urls.at(-1)).toBe('https://music.apple.com/gb/album/43')
  })

  it('links the activity row to the album on Apple Music, so the user can open the release page', async () => {
    mockFetch([
      { ...reviveLookup, results: reviveLookup.results.map((r) => ({ ...r, collectionId: 42 })) },
    ])
    const urls: (string | undefined)[] = []
    const off = activity.subscribe((e) => urls.push(e.url))
    try {
      await getRelease(42)
    } finally {
      off()
    }
    expect(urls).toContain('https://music.apple.com/es/album/42')
  })
})
