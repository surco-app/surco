import { afterEach, describe, expect, it, vi } from 'vitest'

// Every call paces through the shared limiter; mock it to a no-op so these unit tests
// don't wait on real timers between requests.
vi.mock('./deezerLimiter', () => ({ deezerLimiter: { acquire: vi.fn() } }))

// The search/release caches persist through lookupCacheStore, which reads
// app.getPath('userData'); point it at a throwaway temp dir so these unit tests
// never touch a real user profile.
const { deezerCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { deezerCacheDir: mkdtempSync(join(tmpdir(), 'surco-deezer-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => deezerCacheDir, on: () => {} } }))

import { getRelease, groupByAlbum, search } from './deezer'

// Deezer answers every endpoint with JSON bodies; errors ride a 200 with an `error`
// object, so the mock always responds ok and the body drives each scenario.
function mockFetch(bodies: unknown[]): ReturnType<typeof vi.fn> {
  let call = 0
  const fn = vi.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => bodies[Math.min(call++, bodies.length - 1)],
  }))
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

describe('groupByAlbum', () => {
  // The search endpoint returns one hit per TRACK; the results column lists releases,
  // so two tracks of the same album must collapse into one row, keeping Deezer's
  // relevance order by first appearance.
  it('collapses track hits into one result per album, keeping order', () => {
    const hits = [
      {
        id: 1,
        title: 'pa ti toa <3',
        artist: { name: 'Ana Mena' },
        album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm10', cover_xl: 'xl10' },
      },
      {
        id: 2,
        title: 'pa ti toa <3 (acústico)',
        artist: { name: 'Ana Mena' },
        album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm10', cover_xl: 'xl10' },
      },
      {
        id: 3,
        title: 'pa ti toa remix',
        artist: { name: 'Otro' },
        album: { id: 20, title: 'Remixes', cover_medium: 'm20', cover_xl: 'xl20' },
      },
    ]
    expect(groupByAlbum(hits)).toEqual([
      {
        provider: 'deezer',
        id: 10,
        title: 'Ana Mena - pa ti toa <3',
        thumb: 'm10',
        cover_image: 'xl10',
      },
      { provider: 'deezer', id: 20, title: 'Otro - Remixes', thumb: 'm20', cover_image: 'xl20' },
    ])
  })

  it('drops hits without album data, which name nothing fetchable', () => {
    expect(groupByAlbum([{ id: 1, title: 'huérfano' }])).toEqual([])
  })
})

describe('getRelease', () => {
  const album = {
    id: 10,
    title: 'pa ti toa <3',
    artist: { name: 'Ana Mena' },
    contributors: [
      { name: 'Ana Mena', role: 'Main' },
      { name: 'Lola Indigo', role: 'Main' },
      { name: 'Productor X', role: 'Featured' },
    ],
    release_date: '2026-06-12',
    genres: { data: [{ name: 'Pop' }] },
    cover_xl: 'xl10',
  }
  const tracksPage = {
    data: [
      {
        id: 1,
        title: 'pa ti toa <3',
        duration: 213,
        track_position: 1,
        artist: { name: 'Ana Mena' },
      },
    ],
  }

  // The scorer compares durations as "m:ss" and credits every Main contributor — a
  // collaboration single must not lose its second act to the lead-only `artist` field.
  it('maps album + paged tracks to a Release with m:ss durations and all main artists', async () => {
    mockFetch([album, tracksPage])
    const rel = await getRelease(10)
    expect(rel).toMatchObject({
      provider: 'deezer',
      id: 10,
      title: 'pa ti toa <3',
      artists: [{ name: 'Ana Mena' }, { name: 'Lola Indigo' }],
      year: 2026,
      genres: ['Pop'],
      images: [{ uri: 'xl10', type: 'primary', resource_url: 'xl10' }],
    })
    expect(rel.tracklist).toEqual([
      { position: '1', artists: [{ name: 'Ana Mena' }], title: 'pa ti toa <3', duration: '3:33' },
    ])
  })

  // Quota exhaustion arrives as HTTP 200 with error.code 4 — it must retry, not map an
  // empty release from the error body.
  it('retries a quota body and succeeds on the next attempt', async () => {
    vi.useFakeTimers()
    try {
      mockFetch([{ error: { code: 4 } }, { ...album, id: 11 }, tracksPage])
      const p = getRelease(11)
      await vi.runAllTimersAsync()
      const rel = await p
      expect(rel.title).toBe('pa ti toa <3')
    } finally {
      vi.useRealTimers()
    }
  })

  it('serves a repeated release from the cache without refetching', async () => {
    const fn = mockFetch([{ ...album, id: 12 }, tracksPage])
    await getRelease(12)
    const calls = fn.mock.calls.length
    await getRelease(12)
    expect(fn.mock.calls.length).toBe(calls)
  })
})

describe('search', () => {
  // The raw file-derived query often finds nothing where a relaxed candidate would; the
  // ladder must fall through to the next candidate instead of returning the empty set.
  it('falls through empty candidates until one returns results', async () => {
    const hit = {
      id: 1,
      title: 'pa ti toa <3',
      artist: { name: 'Ana Mena' },
      album: { id: 10, title: 'pa ti toa <3', cover_medium: 'm', cover_xl: 'xl' },
    }
    mockFetch([{ data: [] }, { data: [hit] }])
    const results = await search('01 pa ti toa (vinyl rip)', 'high', {
      artist: 'Ana Mena',
      title: 'pa ti toa',
    })
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe(10)
  })
})
