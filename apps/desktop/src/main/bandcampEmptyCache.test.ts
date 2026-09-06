import { afterEach, describe, expect, it, vi } from 'vitest'

// Same harness as bandcamp.test.ts: the limiter is a no-op and the persistent lookup
// cache is pointed at a throwaway dir so the test never touches a real user profile.
vi.mock('./bandcampLimiter', () => ({ bandcampLimiter: { acquire: vi.fn() } }))

const { bandcampCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { bandcampCacheDir: mkdtempSync(join(tmpdir(), 'surco-bandcamp-empty-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => bandcampCacheDir, on: () => {} } }))

import { search } from './bandcamp'

function mockSearch(results: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ auto: { results } }),
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

// A 200 whose body does not carry auto.results at all — the shape drift the module's
// own header warns about ("Bandcamp's autocomplete is an unofficial endpoint").
function mockShapeDrift(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => ({ status: 200, ok: true, json: async () => ({}) }))
  vi.stubGlobal('fetch', fn)
  return fn
}

const HIT = {
  type: 't',
  id: 42,
  name: 'Track',
  band_name: 'Artist',
  item_url_path: 'https://artist.bandcamp.com/track/track',
  art_id: 1,
}

afterEach(() => vi.restoreAllMocks())

// searchOnce caches with `cacheStore.setSearch(key, results)` unconditionally and reads
// back with `if (cached) return cached` — and `[]` is truthy. lookupCacheStore has no TTL
// and no invalidation API (only 300-entry LRU eviction by OTHER queries), and it persists
// to userData, so an empty answer from one transient hiccup shadows the network for that
// query for the life of the profile. deezer.test.ts already documents the team hitting
// this exact mechanism ("getSearch read back the cached [] as truthy ... without ever
// hitting the network again"); that fix only namespaced the key, leaving the hazard.
describe('an empty Bandcamp answer must not poison the query forever', () => {
  it('retries the network after a 200 whose payload carried no results', async () => {
    const drift = mockShapeDrift()
    expect(await search('artist title')).toEqual([])
    expect(drift.mock.calls.length).toBeGreaterThan(0)

    // The endpoint recovers and now answers with a real hit for the same query.
    const good = mockSearch([HIT])
    const results = await search('artist title')

    // Currently the cached [] short-circuits: fetch is never called and the DJ's track
    // stays permanently un-matchable, across restarts, with no way to clear it.
    expect(good.mock.calls.length).toBeGreaterThan(0)
    expect(results).toHaveLength(1)
  })

  it('retries the network after every hit was filtered out as unusable', async () => {
    // A 200 with real results that mapResult all reject (no item_url_path), so the
    // filter empties the array — an empty cache entry from a perfectly healthy request.
    const filtered = mockSearch([{ type: 't', id: 7, name: 'No URL', art_id: 1 }])
    expect(await search('other query')).toEqual([])
    expect(filtered.mock.calls.length).toBeGreaterThan(0)

    const good = mockSearch([{ ...HIT, id: 99 }])
    const results = await search('other query')

    expect(good.mock.calls.length).toBeGreaterThan(0)
    expect(results).toHaveLength(1)
  })
})
