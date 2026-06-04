import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRelease, search } from './discogs'

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
