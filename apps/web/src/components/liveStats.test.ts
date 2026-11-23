import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Stats, StatsRelease } from '../lib/stats'
import { fetchLiveStats } from './Stats'

const stored: Stats = {
  days: [
    { date: '2026-11-22', mac: 448, windows: 238 },
    { date: '2026-11-23', mac: 454, windows: 239 },
  ],
  versions: [{ version: 'v1.43.0', mac: 0, windows: 0, installs: 0 }],
  usage: [{ week: '2026-11-23', mac: 0, windows: 0 }],
}

const release: StatsRelease = {
  tag_name: 'v1.43.0',
  published_at: '2026-11-01T10:00:00Z',
  assets: [
    { name: 'Surco-arm64.dmg', download_count: 500 },
    { name: 'Surco-arm64.dmg.blockmap', download_count: 0 },
    { name: 'Surco-Setup.exe', download_count: 300 },
    { name: 'Surco-Setup.exe.blockmap', download_count: 50 },
  ],
}

function serve(github: () => Response) {
  vi.stubGlobal('fetch', async (url: string) =>
    url.startsWith('https://raw.githubusercontent.com/')
      ? new Response(JSON.stringify(stored))
      : github(),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

// The snapshot behind the stored file runs whenever GitHub gets to a scheduled workflow,
// which has meant every 4 to 11 hours, so today's figure read from it lags by that much.
describe('stats page figures', () => {
  it('counts today as GitHub counts it now, keeping the stored days before it', async () => {
    serve(() => new Response(JSON.stringify([release])))

    const stats = await fetchLiveStats('2026-11-23T21:00:00Z')

    expect(stats.days).toEqual([
      { date: '2026-11-22', mac: 448, windows: 238 },
      { date: '2026-11-23', mac: 500, windows: 250 },
    ])
  })

  it('adds today when the stored snapshot has not reached it yet', async () => {
    serve(() => new Response(JSON.stringify([release])))

    const stats = await fetchLiveStats('2026-11-24T08:00:00Z')

    expect(stats.days.map((d) => d.date)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24'])
  })

  it('falls back to the stored figures when GitHub refuses the live count, as it does past 60 requests an hour', async () => {
    serve(() => new Response('rate limited', { status: 403 }))

    expect(await fetchLiveStats('2026-11-23T21:00:00Z')).toEqual(stored)
  })
})
