import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRelease, retryDelayMs, search } from './discogs'

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
})

describe('search rate-limit retry', () => {
  // A single 429 during a busy session shouldn't surface as a failure: backing off
  // and retrying recovers transparently.
  it('retries after a 429 and returns the eventual results', async () => {
    const fetchMock = mockSequence([res(429, {}, '0'), res(200, { results: [{ id: 9 }] })])
    const out = await search('retry once query', 'tok')
    expect(out).toEqual([{ id: 9 }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // Persistent 429s must eventually give up — not loop forever — and surface the
  // rate-limit message after a bounded number of attempts.
  it('gives up after the retry limit and surfaces the rate-limit error', async () => {
    const fetchMock = mockSequence([res(429, {}, '0')])
    await expect(search('always limited query', 'tok')).rejects.toThrow(/[Ll]ímite/)
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
