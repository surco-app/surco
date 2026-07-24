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

  // A `next` pointer names whatever URL the response body says; a hostile or
  // compromised response must not redirect our fetches to a third-party host.
  it('stops paging when `next` does not point back at the Deezer API', async () => {
    const firstPage = {
      data: [
        {
          id: 2,
          title: 'pa ti toa <3',
          duration: 213,
          track_position: 1,
          artist: { name: 'Ana Mena' },
        },
      ],
      next: 'https://evil.example/x',
    }
    const fn = mockFetch([{ ...album, id: 13 }, firstPage])
    const rel = await getRelease(13)
    expect(rel.tracklist).toHaveLength(1)
    expect(fn.mock.calls.every(([url]) => !String(url).startsWith('https://evil.example'))).toBe(
      true,
    )
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

describe('search with an ISRC hint', () => {
  const isrcTrack = {
    id: 99,
    title: 'pa ti toa <3',
    artist: { name: 'Ana Mena' },
    album: { id: 50, title: 'pa ti toa <3', cover_medium: 'm50', cover_xl: 'xl50' },
  }
  const remixHit = {
    id: 7,
    title: 'pa ti toa (X Remix)',
    artist: { name: 'X' },
    album: { id: 60, title: 'Remixes', cover_medium: 'm60', cover_xl: 'xl60' },
  }

  // The whole point of the ISRC: the exact recording's album must lead the pool so the
  // probe scores the original before any lookalike, without deduping it twice. The hit
  // is flagged `exact` — the renderer's cross-provider re-rank keys on it, since the
  // album-titled row loses any text-overlap contest against bootlegs that echo the
  // track's own name.
  it('puts the ISRC album first, flagged exact, and appends text results minus the duplicate', async () => {
    mockFetch([isrcTrack, { data: [remixHit, isrcTrack] }])
    const results = await search('ana mena pa ti toa', 'high', { isrc: 'ES5022600597' })
    expect(results.map((r) => r.id)).toEqual([50, 60])
    expect(results[0].exact).toBe(true)
    expect(results[1].exact).toBeUndefined()
  })

  // Deezer answers an unknown ISRC with a 200 "no data" body (code 800) — a miss, not
  // an error: the text ladder must still run.
  it('falls back to the text search when the ISRC is unknown to Deezer', async () => {
    mockFetch([{ error: { code: 800 } }, { data: [remixHit] }])
    const results = await search('cancion desconocida xyz', 'high', { isrc: 'XX0000000000' })
    expect(results.map((r) => r.id)).toEqual([60])
  })

  // Builds before the `exact` flag existed persisted ISRC cache entries without it, and
  // the lookup cache survives updates on disk. Stamping the flag only at write time
  // would leave those legacy entries serving unmarked results forever — the ranking fix
  // silently dead for exactly the tracks the user already searched once.
  it('stamps exact onto a legacy cached ISRC entry that predates the flag', async () => {
    const { writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const legacy = {
      search: [
        [
          'isrc:qq7777777777',
          [
            {
              provider: 'deezer',
              id: 700,
              title: 'Legacy - Cached Album',
              thumb: 'm',
              cover_image: 'xl',
            },
          ],
        ],
      ],
      release: [],
    }
    writeFileSync(join(deezerCacheDir, 'deezer-lookup-cache.json'), JSON.stringify(legacy))
    vi.resetModules()
    const restarted = await import('./deezer')
    const freshFetch = mockFetch([{ data: [] }])
    const results = await restarted.search('legacy cached album', 'high', {
      isrc: 'QQ7777777777',
    })
    expect(results[0]).toMatchObject({ id: 700, exact: true })
    // The ISRC came from the legacy cache, never the network (the one call is the text ladder).
    expect(freshFetch.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  // A text search for the literal string "isrc:XX9999999999" used to cache under the
  // exact same key trackByIsrc uses for that ISRC. The empty text result then shadowed
  // the ISRC lookup: getSearch read back the cached `[]` as truthy and trackByIsrc
  // returned undefined without ever hitting the network again.
  it('does not let a literal "isrc:" text search shadow a later trackByIsrc lookup', async () => {
    const isrcQuery = 'isrc:XX9999999999'
    mockFetch([{ data: [] }])
    await search(isrcQuery, 'high', {})

    const track = {
      id: 123,
      title: 'una cancion',
      artist: { name: 'Alguien' },
      album: { id: 900, title: 'un album', cover_medium: 'm900', cover_xl: 'xl900' },
    }
    mockFetch([track])
    const results = await search('una cancion alguien', 'high', { isrc: 'XX9999999999' })
    expect(results.map((r) => r.id)).toEqual([900])
  })
})
