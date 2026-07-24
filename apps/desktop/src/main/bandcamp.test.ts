import { afterEach, describe, expect, it, vi } from 'vitest'

// Every call paces through the shared limiter; mock it to a no-op so these unit tests
// don't wait on real timers between requests.
vi.mock('./bandcampLimiter', () => ({ bandcampLimiter: { acquire: vi.fn() } }))

// The search/release caches now persist through lookupCacheStore, which reads
// app.getPath('userData'); point it at a throwaway temp dir so these unit tests
// never touch a real user profile. The dir is computed once via vi.hoisted so a
// vi.resetModules() (simulating an app restart) reuses the same dir instead of
// minting a fresh one, letting the persistence test read back what a "previous
// session" wrote.
const { bandcampCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { bandcampCacheDir: mkdtempSync(join(tmpdir(), 'surco-bandcamp-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => bandcampCacheDir, on: () => {} } }))

import { extractTralbum, getRelease, parseRelease, search } from './bandcamp'

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
        art_id: 123,
        item_url_path: 'https://boardsofcanada.bandcamp.com/album/music',
      },
      {
        type: 't',
        id: 22,
        band_name: 'Aphex Twin',
        name: 'Windowlicker',
        art_id: 456,
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
        thumb: 'https://f4.bcbits.com/img/a456_3.jpg',
        cover_image: 'https://f4.bcbits.com/img/a456_0.jpg',
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

  // A file-derived query carries name noise the autocomplete chokes on (returns nothing),
  // so search must fall back to the cleaned/relaxed candidates — here the title hint — the
  // way Discogs does, instead of giving up on the raw string.
  it('leads with a cleaned bare-title candidate from a messy file-name query', async () => {
    const hit = {
      type: 'a',
      id: 7,
      band_name: 'HH Traxx',
      album_name: 'Rock that sound',
      art_id: 9,
      item_url_path: 'https://hhtraxx.bandcamp.com/album/x',
    }
    const fn = vi.fn(async (_url: string, init: { body: string }) => {
      const { search_text } = JSON.parse(init.body) as { search_text: string }
      // Only the bare-title candidate resolves; the noisy file-derived ones return nothing.
      const results =
        search_text.includes('Rock that sound') && !search_text.includes('02') ? [hit] : []
      return { status: 200, ok: true, json: async () => ({ auto: { results } }) }
    })
    vi.stubGlobal('fetch', fn)
    const out = await search('HH Traxx - Rock that sound (Original mix) - 02', 'high', {
      artist: 'Francesco Donadoni',
      title: 'Rock that sound (Original mix)',
    })
    expect(out.map((r) => r.id)).toEqual([7])
    // The first candidate is the cleaned bare title (track-number tail cut, "(Original mix)"
    // dropped) — so it resolves at once, with the noisy raw query never even tried.
    const first = JSON.parse(fn.mock.calls[0][1].body as string).search_text as string
    expect(first).toBe('HH Traxx - Rock that sound')
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

describe('getRelease — SSRF guard', () => {
  // The renderer names this URL (it comes back from search results the user
  // clicked, or could be forged by a compromised renderer), and a compromised
  // renderer could point it at a cloud metadata service or an internal service
  // instead of a real Bandcamp page. The trusted main process must refuse to
  // fetch it before any network call, the same guard coverDownload.ts already
  // applies to cover URLs.
  it('refuses to fetch a loopback URL without ever calling fetch', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    await expect(getRelease('http://127.0.0.1:8080/admin')).rejects.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })

  it('refuses to fetch a cloud metadata / link-local address', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    await expect(getRelease('http://169.254.169.254/latest/meta-data/')).rejects.toThrow()
    expect(fn).not.toHaveBeenCalled()
  })

  it('refuses a non-http(s) scheme', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    await expect(getRelease('file:///etc/passwd')).rejects.toThrow()
    expect(fn).not.toHaveBeenCalled()
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

  // Bandcamp repeats the artist as a "Artist - " prefix inside its own title strings, so a
  // single-track release lands "Dj Mateu - Crazy Bounce" in both title and album. The artist
  // is already known (data.artist), so the prefix is redundant and must be stripped — the
  // album should read "Crazy Bounce", not "Dj Mateu - Crazy Bounce".
  it('strips the release-artist prefix from a self-prefixed release title', () => {
    const html = pageWith({
      id: 1,
      artist: 'Dj Mateu',
      current: { title: 'Dj Mateu - Crazy Bounce' },
      trackinfo: [{ track_num: 1, title: 'Dj Mateu - Crazy Bounce', duration: 389 }],
    })
    const rel = parseRelease(html, 'https://x.bc')
    expect(rel.title).toBe('Crazy Bounce')
    expect(rel.tracklist[0].title).toBe('Crazy Bounce')
  })

  // A compilation carries the real artist per track in trackinfo[].artist (the release-level
  // artist is the label), and repeats it as a prefix in the track title. That per-track artist
  // must reach the tracklist (so the editor's Artist fills correctly, not with the label), and
  // its prefix must be stripped from the track title.
  it('exposes the per-track artist and strips its prefix on a compilation', () => {
    const html = pageWith({
      id: 2,
      artist: 'Beats Maker Studios',
      current: { title: 'Various Artists Compilation' },
      trackinfo: [
        { track_num: 1, artist: 'Annwn', title: 'Annwn - First Contact', duration: 200 },
        { track_num: 2, artist: 'Racheil Hearbsc', title: 'Racheil Hearbsc - Hard Hop', duration: 210 },
      ],
    })
    const rel = parseRelease(html, 'https://x.bc')
    expect(rel.tracklist[0]).toMatchObject({ artists: [{ name: 'Annwn' }], title: 'First Contact' })
    expect(rel.tracklist[1]).toMatchObject({
      artists: [{ name: 'Racheil Hearbsc' }],
      title: 'Hard Hop',
    })
  })

  // A dash that is NOT an artist prefix is a legitimate part of the title and must survive:
  // "Closer - Precursor Mix" keeps its dash because "Closer" is not the known artist.
  it('leaves a legitimate dash in the title untouched', () => {
    const html = pageWith({
      id: 3,
      artist: 'Nine Inch Nails',
      current: { title: 'Closer - Precursor Mix' },
      trackinfo: [{ track_num: 1, title: 'Closer - Precursor Mix', duration: 300 }],
    })
    const rel = parseRelease(html, 'https://x.bc')
    expect(rel.title).toBe('Closer - Precursor Mix')
    expect(rel.tracklist[0].title).toBe('Closer - Precursor Mix')
  })
})

describe('lookup cache persistence across sessions', () => {
  // The whole point of backing the caches with lookupCacheStore: a search/release
  // already fetched in a previous session must come back on the next launch without
  // hitting Bandcamp again — vi.resetModules() plus a fresh import simulates that
  // restart against the same on-disk cache file.
  it('serves a search and a release from a previous session without refetching', async () => {
    vi.useFakeTimers()
    const searchFetch = mockSearch([
      { type: 'a', id: 41, band_name: 'B', album_name: 'A', item_url_path: 'https://b.bc/a' },
    ])
    await search('persisted bandcamp search')
    const releaseFetch = mockPage(pageWith({ id: 9001, artist: 'A', current: { title: 'T' } }))
    await getRelease('https://x.bandcamp.com/album/persisted')
    // Flush the debounced disk write before "restarting".
    await vi.runAllTimersAsync()
    vi.useRealTimers()

    vi.resetModules()
    const restarted = await import('./bandcamp')
    const freshFetch = vi.fn()
    vi.stubGlobal('fetch', freshFetch)

    const searchResult = await restarted.search('persisted bandcamp search')
    const release = await restarted.getRelease('https://x.bandcamp.com/album/persisted')
    expect(searchResult.map((r) => r.id)).toEqual([41])
    expect(release.id).toBe(9001)
    expect(freshFetch).not.toHaveBeenCalled()
    expect(searchFetch).toHaveBeenCalledTimes(1)
    expect(releaseFetch).toHaveBeenCalledTimes(1)
  })
})
