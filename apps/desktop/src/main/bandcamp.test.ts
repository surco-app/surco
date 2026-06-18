import { afterEach, describe, expect, it, vi } from 'vitest'

// Every call paces through the shared limiter; mock it to a no-op so these unit tests
// don't wait on real timers between requests.
vi.mock('./bandcampLimiter', () => ({ bandcampLimiter: { acquire: vi.fn() } }))

import { extractTralbum, getRelease, parseRelease, search, upscaleArt } from './bandcamp'

// The autocomplete endpoint answers POSTs with results under auto.results.
function mockSearch(results: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ auto: { results } }),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

// A release fetch returns the HTML page; the client reads the embedded data-tralbum.
function mockPage(html: string): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ status: 200, ok: true, text: async () => html }))
  vi.stubGlobal('fetch', fn)
  return fn
}

// Builds a page whose data-tralbum attribute is HTML-escaped exactly as Bandcamp ships it,
// so the client's unescape + parse is exercised end to end.
function pageWith(tralbum: unknown, tags: string[] = []): string {
  const attr = JSON.stringify(tralbum)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
  const tagLinks = tags.map((t) => `<a class="tag" href="/tag/${t}">${t}</a>`).join('')
  return `<html><body data-tralbum="${attr}">${tagLinks}</body></html>`
}

afterEach(() => vi.unstubAllGlobals())

describe('search', () => {
  // The combined list needs each hit tagged with its provider (for the pill) and a
  // releaseUrl (Bandcamp loads a release by its page, not a numeric id).
  it('maps album and track hits to normalized results carrying provider and releaseUrl', async () => {
    mockSearch([
      {
        type: 'a',
        id: 11,
        band_name: 'Boards of Canada',
        album_name: 'Music Has The Right To Children',
        img: 'https://f4.bcbits.com/img/a123_3.jpg',
        item_url_path: 'https://boardsofcanada.bandcamp.com/album/music',
      },
      {
        type: 't',
        id: 22,
        band_name: 'Aphex Twin',
        name: 'Windowlicker',
        img: 'https://f4.bcbits.com/img/456_3.jpg',
        item_url_path: 'https://aphextwin.bandcamp.com/track/windowlicker',
      },
    ])
    const out = await search('whatever')
    expect(out).toEqual([
      {
        provider: 'bandcamp',
        id: 11,
        title: 'Boards of Canada - Music Has The Right To Children',
        thumb: 'https://f4.bcbits.com/img/a123_3.jpg',
        cover_image: 'https://f4.bcbits.com/img/a123_0.jpg',
        releaseUrl: 'https://boardsofcanada.bandcamp.com/album/music',
      },
      {
        provider: 'bandcamp',
        id: 22,
        title: 'Aphex Twin - Windowlicker',
        thumb: 'https://f4.bcbits.com/img/456_3.jpg',
        cover_image: 'https://f4.bcbits.com/img/456_0.jpg',
        releaseUrl: 'https://aphextwin.bandcamp.com/track/windowlicker',
      },
    ])
  })

  // Band/label hits ('b') have no release to fetch, so they must not pollute the list.
  it('drops band/label hits', async () => {
    mockSearch([
      { type: 'b', id: 1, name: 'Warp Records', item_url_path: 'https://warp.bandcamp.com' },
      {
        type: 'a',
        id: 2,
        band_name: 'X',
        album_name: 'Y',
        item_url_path: 'https://x.bandcamp.com/album/y',
      },
    ])
    const out = await search('warp')
    expect(out.map((r) => r.id)).toEqual([2])
  })

  // The autocomplete fires on every keystroke against an unofficial endpoint; a repeated
  // query must come from cache instead of hitting Bandcamp again.
  it('serves a repeated query from cache', async () => {
    const fn = mockSearch([
      { type: 'a', id: 3, band_name: 'B', album_name: 'A', item_url_path: 'https://b.bc/a' },
    ])
    await search('cache me')
    await search('cache me')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('getRelease', () => {
  const tralbum = {
    id: 99,
    artist: 'Boards of Canada',
    art_id: 3351001335,
    current: { title: 'Music Has The Right To Children', release_date: '20 Apr 1998 00:00:00 GMT' },
    trackinfo: [
      { track_num: 1, title: 'Wildlife Analysis', duration: 75.6267 },
      { track_num: 2, title: 'An Eagle In Your Mind', duration: 385.52 },
    ],
  }

  // The tracklist and its durations drive track scoring; Bandcamp ships seconds as a
  // float while the scorer reads "m:ss", so the client must convert. Year comes from the
  // human release_date string.
  it('parses data-tralbum into a normalized release with m:ss tracklist and year', async () => {
    mockPage(pageWith(tralbum, ['idm', 'electronic']))
    const rel = await getRelease('https://boardsofcanada.bandcamp.com/album/music')
    expect(rel).toEqual({
      provider: 'bandcamp',
      id: 99,
      title: 'Music Has The Right To Children',
      artists: [{ name: 'Boards of Canada' }],
      year: 1998,
      genres: ['idm', 'electronic'],
      images: [
        {
          uri: 'https://f4.bcbits.com/img/a3351001335_0.jpg',
          type: 'primary',
          resource_url: 'https://f4.bcbits.com/img/a3351001335_0.jpg',
        },
      ],
      tracklist: [
        { position: '1', title: 'Wildlife Analysis', duration: '1:16' },
        { position: '2', title: 'An Eagle In Your Mind', duration: '6:26' },
      ],
    })
  })

  // A release fetched twice (probe then preview) must reuse the cached page.
  it('caches a release by its url', async () => {
    const fn = mockPage(pageWith(tralbum))
    await getRelease('https://x.bandcamp.com/album/cached')
    await getRelease('https://x.bandcamp.com/album/cached')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('extractTralbum / parseRelease', () => {
  // The attribute is HTML-escaped; the unescape must round-trip quotes and ampersands so
  // a title like «Rock & "Roll"» parses instead of throwing.
  it('unescapes HTML entities before parsing', () => {
    const html = pageWith({
      id: 1,
      artist: 'A & B',
      current: { title: 'The "Best"' },
      trackinfo: [],
    })
    const data = extractTralbum(html)
    expect(data?.artist).toBe('A & B')
    expect(data?.current?.title).toBe('The "Best"')
  })

  // A page without the attribute (a deleted release, a captcha wall) must fail loudly,
  // not hand back a half-built release.
  it('throws when the page carries no data-tralbum', () => {
    expect(() => parseRelease('<html><body>nope</body></html>', 'https://x.bc')).toThrow()
  })
})

describe('upscaleArt', () => {
  // Search hands back the tiny _3 thumbnail; the cover picker wants the full-size art.
  it('swaps the size suffix to the requested size', () => {
    expect(upscaleArt('https://f4.bcbits.com/img/a123_3.jpg', 0)).toBe(
      'https://f4.bcbits.com/img/a123_0.jpg',
    )
    expect(upscaleArt(undefined, 0)).toBeUndefined()
  })
})
