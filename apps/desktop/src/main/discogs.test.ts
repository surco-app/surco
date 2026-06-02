import { afterEach, describe, expect, it, vi } from 'vitest'
import { search } from './discogs'

function mockFetch(results: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ results }),
  }))
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
})
