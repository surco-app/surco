import { afterEach, describe, expect, it, vi } from 'vitest'

// The client now paces every call through the shared limiter; mock it to a no-op so
// these unit tests don't wait on real timers between requests.
vi.mock('./discogsLimiter', () => ({ discogsLimiter: { acquire: vi.fn() } }))

import type { SearchResult } from '../shared/types'
import { discogsLimiter } from './discogsLimiter'
import {
  dedupeResults,
  downloadCover,
  getRelease,
  hasCachedRelease,
  hasCachedSearch,
  matchesFormats,
  retryDelayMs,
  search,
} from './discogs'

const result = (over: Partial<SearchResult>): SearchResult =>
  ({ id: 1, title: 'X', ...over }) as SearchResult

// A response double covering the fields api() reads: status/ok, the JSON body, and
// a headers.get used only on the 429 path.
function res(status: number, body: unknown, retryAfter?: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (h: string) => (h.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
    },
    json: async () => body,
  }
}

// Returns each queued response in turn, repeating the last so "always 429" needs
// only one entry.
function mockSequence(responses: ReturnType<typeof res>[]): ReturnType<typeof vi.fn> {
  let i = 0
  const fn = vi.fn(async () => responses[Math.min(i++, responses.length - 1)])
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockFetch(results: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ results }),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockRelease(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ status: 200, ok: true, json: async () => body }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('search', () => {
  // The auto-search fires on every keystroke, so without caching identical
  // queries would each hit Discogs and exhaust its 60 req/min limit (429).
  it('serves a repeated query from cache instead of hitting Discogs again', async () => {
    const fetchMock = mockFetch([{ id: 1 }])
    const first = await search('aphex twin', 'tok')
    const second = await search('aphex twin', 'tok')
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keys the cache by query so a different search still fetches', async () => {
    const fetchMock = mockFetch([{ id: 2 }])
    await search('boards of canada', 'tok')
    await search('autechre', 'tok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The rate limiter peeks this to let a cached repeat through without spending a token —
  // a cache hit makes no network call, so it must not be paced. Keyed like the cache itself.
  it('reports a query as cached only once it has been fetched, normalizing the key', async () => {
    mockFetch([{ id: 1 }])
    expect(hasCachedSearch('plaid')).toBe(false)
    await search('plaid', 'tok')
    expect(hasCachedSearch('plaid')).toBe(true)
    expect(hasCachedSearch('  PLAID ')).toBe(true)
  })

  // A user's own token gets its own 60 req/min bucket, so when set it must win.
  it('authenticates with the user token when one is set', async () => {
    const fetchMock = mockFetch([{ id: 3 }])
    await search('user token search', 'usertok')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('token=usertok')
    expect(url).not.toContain('key=')
    expect(url).not.toContain('secret=')
  })

  // Without a user token Surco falls back to its own app key/secret so search
  // works out of the box — no token required to use the app.
  it('falls back to the app key and secret when no user token is set', async () => {
    const fetchMock = mockFetch([{ id: 4 }])
    await search('app key search', '')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('key=')
    expect(url).toContain('secret=')
    expect(url).not.toContain('token=')
  })

  // The first candidate keeps the mix name; when it finds nothing the client retries
  // the parenthetical-stripped query, which is what surfaces the release.
  it('falls back to the parenthetical-stripped query when the fuller one finds nothing', async () => {
    const fetchMock = mockSequence([
      res(200, { results: [] }),
      res(200, { results: [{ id: 9 }] }),
    ])
    const out = await search('Cascade Probe (Original Mix)', 'tok')
    expect(out).toEqual([{ id: 9, provider: 'discogs' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const second = fetchMock.mock.calls[1][0] as string
    expect(second).toContain(encodeURIComponent('Cascade Probe'))
    expect(second).not.toContain(encodeURIComponent('(Original Mix)'))
  })
})

describe('getRelease', () => {
  // Hover-prefetch warms the top release so opening a track shows its tracklist
  // (and the suggested-track tick) with no network wait; caching by id means that
  // warm-up, and the click that follows, hit Discogs only once.
  it('serves a repeated release id from cache instead of hitting Discogs again', async () => {
    const fetchMock = mockRelease({ id: 7001, title: 'X', artists: [], tracklist: [] })
    const first = await getRelease(7001, 'tok')
    const second = await getRelease(7001, 'tok')
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports a release id as cached only once it has been fetched', async () => {
    mockRelease({ id: 7100, title: 'X', artists: [], tracklist: [] })
    expect(hasCachedRelease(7100)).toBe(false)
    await getRelease(7100, 'tok')
    expect(hasCachedRelease(7100)).toBe(true)
  })

  it('keys the cache by id so a different release still fetches', async () => {
    const fetchMock = mockRelease({ id: 0, title: 'X', artists: [], tracklist: [] })
    await getRelease(7002, 'tok')
    await getRelease(7003, 'tok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('retryDelayMs', () => {
  // Discogs returns Retry-After (in seconds) on a 429; honoring it waits exactly as
  // long as asked instead of guessing.
  it('honors a numeric Retry-After header, converted to ms', () => {
    expect(retryDelayMs(0, '2')).toBe(2000)
  })

  it('retries immediately when the server says Retry-After: 0', () => {
    expect(retryDelayMs(0, '0')).toBe(0)
  })

  // No header → exponential backoff so repeated hammering eases off rather than
  // retrying at a fixed interval.
  it('backs off exponentially when there is no header', () => {
    expect(retryDelayMs(0, null)).toBe(1000)
    expect(retryDelayMs(2, null)).toBe(4000)
  })

  it('caps the backoff so a late attempt never waits absurdly long', () => {
    expect(retryDelayMs(10, null)).toBe(8000)
  })

  // A hostile or buggy Retry-After (e.g. 3600s) would otherwise sleep for an hour
  // while still holding the request's rate-limiter token. The same ceiling applies.
  it('caps an oversized Retry-After header to the same ceiling', () => {
    expect(retryDelayMs(0, '3600')).toBe(8000)
  })
})

describe('search rate-limit retry', () => {
  // A single 429 during a busy session shouldn't surface as a failure: backing off
  // and retrying recovers transparently.
  it('retries after a 429 and returns the eventual results', async () => {
    const fetchMock = mockSequence([res(429, {}, '0'), res(200, { results: [{ id: 9 }] })])
    const out = await search('retry once query', 'tok')
    expect(out).toEqual([{ id: 9, provider: 'discogs' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // The first attempt spends a limiter token; the retry is a separate request, so it
  // must take another token rather than slipping past the limiter during a 429 storm.
  it('takes a fresh limiter token for the retry, not just the first attempt', async () => {
    vi.mocked(discogsLimiter.acquire).mockClear()
    mockSequence([res(429, {}, '0'), res(200, { results: [{ id: 11 }] })])
    await search('retry token query', 'tok')
    expect(discogsLimiter.acquire).toHaveBeenCalledTimes(2)
  })

  // Persistent 429s must eventually give up — not loop forever — and surface the
  // rate-limit message after a bounded number of attempts.
  it('gives up after the retry limit and surfaces the rate-limit error', async () => {
    const fetchMock = mockSequence([res(429, {}, '0')])
    await expect(search('always limited query', 'tok')).rejects.toThrow(/[Ll]ímite/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('request timeout', () => {
  // A hung connection (sleep/wake, captive portal) must not leave the search pending
  // forever with its limiter token spent: every request carries an abort signal so a
  // stalled socket times out instead of hanging the caller.
  it('sends every API request with an abort signal so a stalled socket times out', async () => {
    const fetchMock = mockFetch([{ id: 9 }])
    await search('timeout probe query', '')
    const opts = fetchMock.mock.calls[0][1] as { signal?: unknown }
    expect(opts?.signal).toBeInstanceOf(AbortSignal)
  })

  it('downloads covers with the same timeout guard', async () => {
    const fn = vi.fn(async (_url: string, _opts?: { signal?: unknown }) => ({
      ok: false,
      status: 500,
      headers: { get: () => null },
    }))
    vi.stubGlobal('fetch', fn)
    await expect(downloadCover('https://img.discogs.com/x.jpg')).rejects.toThrow()
    expect(fn.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('downloadCover image validation', () => {
  function mockBytes(bytes: number[]): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new Uint8Array(bytes).buffer,
    }))
    vi.stubGlobal('fetch', fn)
    return fn
  }

  // A link dragged from a browser often points at the page the image sat on, not the
  // image — the server answers 200 with HTML. Saving that as .jpg only blows up later
  // inside ffmpeg, so reject it up front on the bytes, not the (absent) content-type.
  it('rejects a URL whose bytes are not a known image', async () => {
    mockBytes([...Buffer.from('<!DOCTYPE html><html></html>')])
    await expect(downloadCover('https://page.example/article')).rejects.toThrow(
      /no apunta a una imagen/i,
    )
  })

  // The saved extension follows the magic bytes, not the URL, so a PNG served from a
  // .jpg URL is named correctly for the downstream ffmpeg pass.
  it('names the file by its magic bytes, not the URL', async () => {
    mockBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(downloadCover('https://img.example/cover.jpg')).resolves.toMatch(/\.png$/)
  })
})

describe('matchesFormats', () => {
  // The user filters search to certain release formats (e.g. only Vinyl). An empty
  // filter must accept everything, so the default behaviour is unchanged.
  it('accepts every result when no format is selected', () => {
    expect(matchesFormats(result({ format: ['CD', 'Album'] }), [])).toBe(true)
  })

  it('keeps a result carrying one of the selected formats', () => {
    expect(matchesFormats(result({ format: ['Vinyl', 'LP', 'Album'] }), ['Vinyl'])).toBe(true)
  })

  it('drops a result in none of the selected formats', () => {
    expect(matchesFormats(result({ format: ['CD', 'Album'] }), ['Vinyl'])).toBe(false)
  })

  it('treats a result with no format array as not matching an active filter', () => {
    expect(matchesFormats(result({ format: undefined }), ['Vinyl'])).toBe(false)
  })
})

describe('search format filter', () => {
  // One selected format goes through the API's own filter, so the whole 20-result page
  // comes back as that format instead of a mix we'd thin out afterwards.
  it('filters server-side via the format param when exactly one format is selected', async () => {
    const fetchMock = mockFetch([{ id: 1, format: ['Vinyl', 'LP'] }])
    await search('format one vinyl', 'tok', undefined, undefined, ['Vinyl'])
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('format=Vinyl')
    expect(url).toContain('per_page=20')
  })

  // The API takes only one format value, so several selected formats fetch a larger page
  // and filter in the client — keeping a result that carries any chosen format.
  it('filters client-side and fetches a larger page when several formats are selected', async () => {
    const fetchMock = mockFetch([
      { id: 1, format: ['Vinyl', 'LP'] },
      { id: 2, format: ['CD', 'Album'] },
      { id: 3, format: ['Cassette'] },
    ])
    const res = await search('format many', 'tok', undefined, undefined, ['Vinyl', 'CD'])
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('&format=')
    expect(url).toContain('per_page=50')
    expect(res.map((r) => r.id)).toEqual([1, 2])
  })

  // No filter is the default: the request must look exactly as before, with no format
  // param and the original page size.
  it('adds no format param and keeps page 20 when no format is selected', async () => {
    const fetchMock = mockFetch([{ id: 1 }])
    await search('format none', 'tok')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).not.toContain('format=')
    expect(url).toContain('per_page=20')
  })
})

describe('dedupeResults', () => {
  // A popular album returns the same row once per repress; collapsing rows that render
  // identically (title, year, label, format) keeps the list readable.
  it('collapses results that would render identically, keeping the first', () => {
    const out = dedupeResults([
      result({ id: 1, title: 'Discovery', year: '2001', label: ['Virgin'], format: ['Vinyl', 'LP'] }),
      result({ id: 2, title: 'Discovery', year: '2001', label: ['Virgin'], format: ['Vinyl', 'LP'] }),
    ])
    expect(out.map((r) => r.id)).toEqual([1])
  })

  // Editions that differ in any shown field are distinct (their tracklist/catno may be
  // the one the user needs), so they must survive.
  it('keeps editions that differ in year, label or format', () => {
    const out = dedupeResults([
      result({ id: 1, title: 'Discovery', year: '2001', label: ['Virgin'], format: ['Vinyl'] }),
      result({ id: 2, title: 'Discovery', year: '2021', label: ['Virgin'], format: ['Vinyl'] }),
      result({ id: 3, title: 'Discovery', year: '2001', label: ['Virgin'], format: ['CD'] }),
    ])
    expect(out.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('search collapses duplicate editions from the response', async () => {
    mockFetch([
      { id: 1, title: 'Dup', year: '2001', label: ['L'], format: ['Vinyl'] },
      { id: 2, title: 'Dup', year: '2001', label: ['L'], format: ['Vinyl'] },
    ])
    const out = await search('dedupe search query', 'tok')
    expect(out.map((r) => r.id)).toEqual([1])
  })
})
