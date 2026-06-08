import { describe, expect, it, vi } from 'vitest'
import type { DiscogsRelease, DiscogsSearchResult } from '../../../shared/types'
import { autoMatchRelease } from './autoMatch'

function release(id: number, over: Partial<DiscogsRelease> = {}): DiscogsRelease {
  return { id, title: 'Album', artists: [], tracklist: [], ...over }
}

function searchResult(id: number): DiscogsSearchResult {
  return { id, title: `Result ${id}` }
}

// Title + duration both agreeing scores 1.0 → 'high', the only tier auto-match applies.
const HIGH = { position: '1', title: 'My Song', duration: '3:20' }
// Title alone, a substring hit (0.7) with no duration → 'review', not auto-applied.
const REVIEW = { title: 'My Song (Club Mix)', position: '1' }

const target = { title: 'My Song', durationSec: 200 }

describe('autoMatchRelease', () => {
  it('returns the first release whose best track is high confidence', async () => {
    const api = {
      searchDiscogs: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
      getRelease: vi
        .fn()
        .mockResolvedValueOnce(release(1, { tracklist: [REVIEW] }))
        .mockResolvedValueOnce(release(2, { tracklist: [HIGH] })),
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(2)
    expect(m?.track).toEqual(HIGH)
  })

  it('stops probing once a high match is found', async () => {
    const api = {
      searchDiscogs: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [HIGH] })),
    }
    await autoMatchRelease('my song', target, api)
    // The first release already matches, so the second is never loaded.
    expect(api.getRelease).toHaveBeenCalledTimes(1)
  })

  it('returns undefined when nothing reaches high confidence', async () => {
    const api = {
      searchDiscogs: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [REVIEW] })),
    }
    expect(await autoMatchRelease('my song', target, api)).toBeUndefined()
  })

  it('skips a release that fails to load and probes the next', async () => {
    const api = {
      searchDiscogs: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
      getRelease: vi
        .fn()
        .mockRejectedValueOnce(new Error('429'))
        .mockResolvedValueOnce(release(2, { tracklist: [HIGH] })),
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(2)
  })

  it('returns undefined when the search itself fails rather than throwing', async () => {
    const api = {
      searchDiscogs: vi.fn().mockRejectedValue(new Error('network')),
      getRelease: vi.fn(),
    }
    expect(await autoMatchRelease('my song', target, api)).toBeUndefined()
  })

  it('does not call the network without a query or a title to match on', async () => {
    const api = { searchDiscogs: vi.fn(), getRelease: vi.fn() }
    expect(await autoMatchRelease('', target, api)).toBeUndefined()
    expect(await autoMatchRelease('my song', { title: '' }, api)).toBeUndefined()
    expect(api.searchDiscogs).not.toHaveBeenCalled()
  })

  it('probes at most the cap, even when no match is found', async () => {
    const results = Array.from({ length: 20 }, (_, i) => searchResult(i + 1))
    const api = {
      searchDiscogs: vi.fn().mockResolvedValue(results),
      getRelease: vi.fn().mockResolvedValue(release(0, { tracklist: [REVIEW] })),
    }
    await autoMatchRelease('my song', target, api, 8)
    expect(api.getRelease).toHaveBeenCalledTimes(8)
  })
})
