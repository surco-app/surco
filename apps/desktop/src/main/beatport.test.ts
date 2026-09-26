import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./beatportLimiter', () => ({ beatportLimiter: { acquire: vi.fn() } }))

const { beatportCacheDir } = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs')
  const { tmpdir } = require('node:os')
  const { join } = require('node:path')
  return { beatportCacheDir: mkdtempSync(join(tmpdir(), 'surco-beatport-cache-')) }
})
vi.mock('electron', () => ({ app: { getPath: () => beatportCacheDir, on: () => {} } }))

import { errorKeyOf } from '../shared/errorKeys'
import { getRelease, groupByRelease, mapRelease, search, setBeatportSession } from './beatport'
import { despechaRelease, despechaTracks, searchHits } from './beatportFixture'
import type { BeatportSession } from './beatportSession'

function fakeSession(tokens: string[] = ['T1', 'T2', 'T3']) {
  let i = 0
  return {
    getAccessToken: async () => tokens[Math.min(i++, tokens.length - 1)],
    invalidate: vi.fn<BeatportSession['invalidate']>(),
    validate: async () => {},
    reset: () => {},
  } satisfies BeatportSession
}

function stubFetch(respond: (url: string, auth: string) => Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string, init?: RequestInit) =>
    respond(input, new Headers(init?.headers).get('authorization') ?? ''),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

async function keyOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (err) {
    return errorKeyOf((err as Error).message)
  }
  return 'resolved'
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('groupByRelease', () => {
  it('groups search hits into one row per release, since the results column lists releases', () => {
    const other = {
      ...searchHits[0],
      id: 1,
      release: { id: 99, name: 'Otro' },
    }
    const rows = groupByRelease([...searchHits, other])
    expect(rows.map((r) => r.id)).toEqual([6386332, 99])
    expect(rows[0]).toMatchObject({
      provider: 'beatport',
      title: 'ROSALÍA - DESPECHÁ',
      label: ['Columbia'],
      catno: 'G010004869119V',
      year: '2022',
    })
    expect(rows[0].thumb).toContain('/image_size/250x250/')
    expect(rows[0].cover_image).toContain('/image_size/1400x1400/')
  })
})

describe('mapRelease', () => {
  it("maps the release and keeps each version's mix, bpm, key and isrc on its track", () => {
    const rel = mapRelease(despechaRelease, despechaTracks)
    expect(rel).toMatchObject({
      provider: 'beatport',
      id: 6386332,
      title: 'DESPECHÁ',
      artists: [{ name: 'ROSALÍA' }],
      labels: [{ name: 'Columbia', catno: 'G010004869119V' }],
      released: '2022-07-28',
      year: 2022,
      genres: ['Latin'],
      styles: ['Merengue'],
      uri: 'https://www.beatport.com/release/despecha/6386332',
    })
    expect(rel.tracklist.map((t) => [t.position, t.title, t.mixName])).toEqual([
      ['1', 'DESPECHÁ', 'Clean'],
      ['2', 'DESPECHÁ', 'Intro - Clean'],
      ['3', 'DESPECHÁ', 'Intro'],
      ['4', 'DESPECHÁ', 'Instrumental'],
    ])
    expect(rel.tracklist[0]).toMatchObject({
      bpm: '130',
      key: 'G Major',
      isrc: 'USSM12207207',
      duration: '2:37',
    })
  })
})

describe('the Beatport API client', () => {
  it('retries once with a fresh token on 401, because tokens die before their clock says so', async () => {
    const session = fakeSession()
    setBeatportSession(session)
    stubFetch((_url, auth) =>
      auth === 'Bearer T1'
        ? new Response('', { status: 401 })
        : Response.json({ tracks: searchHits }),
    )
    const rows = await search('rosalia 401 retry')
    expect(rows).toHaveLength(1)
    expect(session.invalidate).toHaveBeenCalledTimes(1)
  })

  it('a dropped connection reads as Beatport unavailable, not a raw fetch error', async () => {
    setBeatportSession(fakeSession())
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    expect(await keyOf(search('offline query'))).toBe('beatportUnavailable')
  })

  it('a second 401 is an error, not a loop', async () => {
    setBeatportSession(fakeSession())
    const fetch = stubFetch(() => new Response('', { status: 401 }))
    expect(await keyOf(search('always unauthorized'))).toBe('beatportUnavailable')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('sends the accents as typed, since Beatport misses "Rosalia" without them', async () => {
    setBeatportSession(fakeSession())
    const fetch = stubFetch(() => Response.json({ tracks: searchHits }))
    await search('ROSALÍA DESPECHÁ')
    expect(String(fetch.mock.calls[0][0])).toContain(encodeURIComponent('ROSALÍA DESPECHÁ'))
  })

  it('backs off on 429 and gives up with a rate-limit error', async () => {
    vi.useFakeTimers()
    setBeatportSession(fakeSession())
    stubFetch(() => new Response('', { status: 429 }))
    const result = keyOf(search('rate limited query'))
    await vi.runAllTimersAsync()
    expect(await result).toBe('beatportRateLimit')
  })

  it('loads a release with its tracks in two requests', async () => {
    setBeatportSession(fakeSession())
    stubFetch((url) =>
      url.includes('/tracks/')
        ? Response.json({ results: despechaTracks })
        : Response.json(despechaRelease),
    )
    const rel = await getRelease(6386332)
    expect(rel.tracklist).toHaveLength(4)
    expect(rel.labels?.[0].name).toBe('Columbia')
  })
})
