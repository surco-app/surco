import { describe, expect, it, vi } from 'vitest'
import type { Release, SearchProviderId, SearchResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { acceptReviewPatch, autoMatchRelease, matchTargetOf, tracksToAutoMatch } from './autoMatch'
import { confidenceTier } from './release'

function release(id: number, over: Partial<Release> = {}): Release {
  return { provider: 'discogs', id, title: 'Album', artists: [], tracklist: [], ...over }
}

function searchResult(id: number): SearchResult {
  return { provider: 'discogs', id, title: `Result ${id}` }
}

// Title + duration both agreeing scores 1.0 → 'high', the only tier auto-match applies.
const HIGH = { position: '1', title: 'My Song', duration: '3:20' }
// Title alone, a substring hit (0.7) with no duration → 'review', not auto-applied.
const REVIEW = { title: 'My Song (Club Mix)', position: '1' }
// One shared word (0.3) and no duration → 'low', too weak even to flag for review.
const LOW = { title: 'My Different Tune', position: '1' }

const target = { title: 'My Song', durationSec: 200 }

describe('autoMatchRelease', () => {
  it('returns the first release whose best track is high confidence', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
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
      search: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [HIGH] })),
    }
    await autoMatchRelease('my song', target, api)
    // The first release already matches, so the second is never loaded.
    expect(api.getRelease).toHaveBeenCalledTimes(1)
  })

  // No release clears the 'high' bar, but a plausible Discogs title hit ('review' tier) is
  // surfaced as a suggestion for the user to confirm, not dropped: the sweep flags it
  // instead of applying it unattended.
  it('returns a Discogs review-tier match when no high is found', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [REVIEW] })),
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(1)
    expect(confidenceTier(m?.confidence ?? 0)).toBe('review')
  })

  // Below the review bar there's nothing worth a human glance, so the sweep stays silent
  // and leaves the row open for a later re-probe.
  it('returns undefined when nothing even reaches the review bar', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [LOW] })),
    }
    expect(await autoMatchRelease('my song', target, api)).toBeUndefined()
  })

  // A matching catalog number is the strongest evidence a file names this exact pressing, so
  // a review-tier title hit on a release whose catno the file carries is promoted to high and
  // applied unattended — the whole point of scoring the catno: fewer manual reviews.
  it('applies a review-tier match unattended when the file’s catalog number matches the release', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi
        .fn()
        .mockResolvedValue(
          release(1, { tracklist: [REVIEW], labels: [{ name: 'L', catno: 'SR-001' }] }),
        ),
    }
    const withCatno = { ...target, durationSec: undefined, catalogNumber: 'sr 001' }
    const m = await autoMatchRelease('my song', withCatno, api)
    expect(m?.release.id).toBe(1)
    expect(confidenceTier(m?.confidence ?? 0)).toBe('high')
  })

  // The boost lifts, it does not rescue: a matching catno on an otherwise-wrong track (a shared
  // pressing of a different cut) must stay below the bar, so a low-tier hit is never applied.
  it('does not let a matching catalog number rescue a low-tier match', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi
        .fn()
        .mockResolvedValue(
          release(1, { tracklist: [LOW], labels: [{ name: 'L', catno: 'SR-001' }] }),
        ),
    }
    const withCatno = { title: 'My Song', catalogNumber: 'SR-001' }
    expect(await autoMatchRelease('my song', withCatno, api)).toBeUndefined()
  })

  // A release with no durations scores 1.0 on the title alone (weights renormalise over
  // the signals present), so an exact one-word title on another act's release would be
  // applied unattended. The probe must hand that to a human instead: flag it review.
  it('flags an exact-title hit with nothing to corroborate it for review, never applying it', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi.fn().mockResolvedValue(
        release(1, {
          artists: [{ name: 'Another Act' }],
          tracklist: [{ position: '1', title: 'My Song' }],
        }),
      ),
    }
    const m = await autoMatchRelease('my song', { title: 'My Song', artist: 'Artist' }, api)
    expect(m?.release.id).toBe(1)
    expect(m?.tier).toBe('review')
  })

  // The tier callers act on is the probe's guarded verdict, not something re-derived from
  // the raw confidence — a demoted match still carries confidence above the high bar.
  it('reports the guarded tier alongside the raw confidence', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1)]),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [HIGH] })),
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.tier).toBe('high')
  })

  // A high match anywhere outranks a Discogs review suggestion: when Discogs only musters
  // a review-tier hit, a confident Bandcamp match still wins and is applied outright.
  it('prefers a high match from any source over a Discogs review suggestion', async () => {
    const api = {
      search: vi.fn(async (_q: string, provider: SearchProviderId) => [
        searchResult(provider === 'discogs' ? 1 : 2),
      ]),
      getRelease: vi.fn(async (r: { id: number }) =>
        r.id === 1 ? release(1, { tracklist: [REVIEW] }) : release(2, { tracklist: [HIGH] }),
      ),
      providers: ['discogs', 'bandcamp'] as SearchProviderId[],
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(2)
    expect(confidenceTier(m?.confidence ?? 0)).toBe('high')
  })

  // The review suggestion is curated-source only: Bandcamp's uncurated catalog never
  // surfaces a borderline hit for review — only its high-confidence matches are applied.
  it('never surfaces a review-tier suggestion from Bandcamp', async () => {
    const api = {
      search: vi.fn(async (_q: string, provider: SearchProviderId) =>
        provider === 'bandcamp' ? [searchResult(2)] : [],
      ),
      getRelease: vi.fn().mockResolvedValue(release(2, { tracklist: [REVIEW] })),
      providers: ['discogs', 'bandcamp'] as SearchProviderId[],
    }
    expect(await autoMatchRelease('my song', target, api)).toBeUndefined()
  })

  // The API can return a structurally broken release (no tracklist). It must be
  // skipped exactly like one that failed to load — not thrown out of the probe, where
  // it would sink a whole sweep as an unhandled rejection.
  it('skips a malformed release and probes the next', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
      getRelease: vi
        .fn()
        .mockResolvedValueOnce({ id: 1, title: 'Album' } as Release)
        .mockResolvedValueOnce(release(2, { tracklist: [HIGH] })),
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(2)
  })

  it('skips a release that fails to load and probes the next', async () => {
    const api = {
      search: vi.fn().mockResolvedValue([searchResult(1), searchResult(2)]),
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
      search: vi.fn().mockRejectedValue(new Error('network')),
      getRelease: vi.fn(),
    }
    expect(await autoMatchRelease('my song', target, api)).toBeUndefined()
  })

  it('does not call the network without a query or a title to match on', async () => {
    const api = { search: vi.fn(), getRelease: vi.fn() }
    expect(await autoMatchRelease('', target, api)).toBeUndefined()
    expect(await autoMatchRelease('my song', { title: '' }, api)).toBeUndefined()
    expect(api.search).not.toHaveBeenCalled()
  })

  it('probes the release naming the file artist first, even when Discogs ranks it lower', async () => {
    const artistTarget = { title: 'One More Time', artist: 'Daft Punk', durationSec: 320 }
    const api = {
      search: vi.fn().mockResolvedValue([
        { provider: 'discogs', id: 1, title: 'Various - Mega Compilation' },
        { provider: 'discogs', id: 2, title: 'Daft Punk - Discovery' },
      ]),
      getRelease: vi.fn().mockImplementation((result: { id: number }) =>
        Promise.resolve(
          release(result.id, {
            tracklist: [{ position: '1', title: 'One More Time', duration: '5:20' }],
          }),
        ),
      ),
    }
    const m = await autoMatchRelease('one more time daft punk', artistTarget, api)
    // Re-ranking moved Discovery ahead of the compilation, so it matched on the first
    // probe and the compilation was never loaded.
    expect(m?.release.id).toBe(2)
    expect(api.getRelease).toHaveBeenCalledTimes(1)
    expect(api.getRelease).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
  })

  it('probes at most the cap, even when no match is found', async () => {
    const results = Array.from({ length: 20 }, (_, i) => searchResult(i + 1))
    const api = {
      search: vi.fn().mockResolvedValue(results),
      getRelease: vi.fn().mockResolvedValue(release(0, { tracklist: [REVIEW] })),
    }
    await autoMatchRelease('my song', target, api, 8)
    expect(api.getRelease).toHaveBeenCalledTimes(8)
  })
})

describe('autoMatchRelease Bandcamp fallback', () => {
  // Bandcamp-only releases (self-released, netlabels) aren't on Discogs, so when Discogs
  // comes up empty the sweep tries the fallback source and applies a confident match.
  it('falls back to Bandcamp when Discogs finds nothing', async () => {
    const api = {
      search: vi.fn(async (_q: string, provider: SearchProviderId) =>
        provider === 'bandcamp' ? [searchResult(2)] : [],
      ),
      getRelease: vi.fn().mockResolvedValue(release(2, { tracklist: [HIGH] })),
      providers: ['discogs', 'bandcamp'] as SearchProviderId[],
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(2)
    expect(api.search).toHaveBeenCalledWith('my song', 'discogs')
    expect(api.search).toHaveBeenCalledWith('my song', 'bandcamp')
  })

  // The uncurated catalog must clear a stricter bar: a borderline-'high' (~0.88) match that
  // Discogs would apply unattended is rejected when it comes from Bandcamp.
  it('holds the Bandcamp fallback to a stricter confidence floor than Discogs', async () => {
    const borderline = { title: 'My Song', durationSec: 203.53 }
    const mk = (provider: SearchProviderId) => ({
      search: vi.fn(async () => [searchResult(2)]),
      getRelease: vi.fn().mockResolvedValue(release(2, { tracklist: [HIGH] })),
      providers: [provider] as SearchProviderId[],
    })
    expect((await autoMatchRelease('my song', borderline, mk('discogs')))?.release.id).toBe(2)
    expect(await autoMatchRelease('my song', borderline, mk('bandcamp'))).toBeUndefined()
  })

  // Without a duration there's nothing to corroborate a title hit against, so an uncurated
  // source is too risky to probe at all.
  it('does not probe a fallback source for a file with no duration', async () => {
    const api = {
      search: vi.fn(async () => [searchResult(2)]),
      getRelease: vi.fn().mockResolvedValue(release(2, { tracklist: [HIGH] })),
      providers: ['bandcamp'] as SearchProviderId[],
    }
    expect(await autoMatchRelease('my song', { title: 'My Song' }, api)).toBeUndefined()
    expect(api.search).not.toHaveBeenCalled()
  })

  // Discogs is the authoritative source, so a confident Discogs match ends the search —
  // the fallback is never even queried, which also keeps Bandcamp page loads off the sweep.
  it('does not query Bandcamp once Discogs has matched', async () => {
    const api = {
      search: vi.fn(async (_q: string, provider: SearchProviderId) =>
        provider === 'discogs' ? [searchResult(1)] : [searchResult(2)],
      ),
      getRelease: vi.fn().mockResolvedValue(release(1, { tracklist: [HIGH] })),
      providers: ['discogs', 'bandcamp'] as SearchProviderId[],
    }
    const m = await autoMatchRelease('my song', target, api)
    expect(m?.release.id).toBe(1)
    expect(api.search).not.toHaveBeenCalledWith('my song', 'bandcamp')
  })
})

describe('tracksToAutoMatch', () => {
  const track = (over: Partial<TrackItem> = {}): TrackItem =>
    ({
      query: 'artist title',
      autoMatched: false,
      meta: { title: 'Title', discogsReleaseId: undefined },
      ...over,
    }) as TrackItem

  it('keeps tracks that have a query and title but no match yet', () => {
    expect(tracksToAutoMatch([track()])).toHaveLength(1)
  })

  it('skips tracks already auto-matched so a re-run only fills the gaps', () => {
    expect(tracksToAutoMatch([track({ autoMatched: true })])).toHaveLength(0)
  })

  it('skips tracks the user already tagged from a release, never clobbering their pick', () => {
    expect(
      tracksToAutoMatch([
        track({ meta: { title: 'Title', discogsReleaseId: '99' } as TrackItem['meta'] }),
      ]),
    ).toHaveLength(0)
  })

  // A manual pick from a provider that writes no Discogs id (Bandcamp) is still a
  // deliberate match: the neutral `matched` flag keeps the sweep from overwriting it.
  it('skips a track already matched even when it carries no Discogs id', () => {
    expect(tracksToAutoMatch([track({ matched: true })])).toHaveLength(0)
  })

  // A track the sweep flagged for review (a plausible but unconfirmed suggestion) waits for
  // the user to confirm it in the editor; re-running the sweep must not re-probe it.
  it('skips a track flagged for review so a re-run never re-probes it', () => {
    expect(tracksToAutoMatch([track({ matchReview: true })])).toHaveLength(0)
  })

  it('skips tracks with nothing to search or score on', () => {
    expect(tracksToAutoMatch([track({ query: '   ' })])).toHaveLength(0)
    expect(tracksToAutoMatch([track({ meta: { title: '  ' } as TrackItem['meta'] })])).toHaveLength(
      0,
    )
  })
})

describe('matchTargetOf', () => {
  it('reads the title, duration, track number, artist, catalog number and year a probe scores against', () => {
    const t = {
      duration: 211,
      meta: {
        title: 'Song',
        trackNumber: '3',
        artist: 'Artist',
        catalogNumber: 'SR-001',
        year: '2001',
      },
    } as TrackItem
    expect(matchTargetOf(t)).toEqual({
      title: 'Song',
      durationSec: 211,
      trackNumber: '3',
      artist: 'Artist',
      catalogNumber: 'SR-001',
      year: '2001',
    })
  })

  // A file whose title tag is the whole duplicated file name must be cleaned before
  // scoring, or it never reaches the confidence bar against the real track title.
  it('cleans a duplicated, track-numbered file-name title before scoring', () => {
    const t = {
      duration: 398,
      meta: {
        title:
          'Francesco Donadoni - Rock that sound (Original mix) - 02 Francesco Donadoni - Rock that sound (Original mix)',
        trackNumber: '',
        artist: 'HH Traxx',
      },
    } as TrackItem
    expect(matchTargetOf(t).title).toBe('Francesco Donadoni - Rock that sound')
  })
})

describe('acceptReviewPatch', () => {
  const track = (over: Partial<TrackItem> = {}): TrackItem =>
    ({ id: 't1', meta: { title: 'old', artist: 'old' }, ...over }) as TrackItem

  // Accepting a review suggestion applies the stored release just like clicking it in the
  // editor — the whole point of persisting reviewMatch is to skip the editor detour and the
  // re-probe — and it clears the pending flags so the row leaves the review bucket for good.
  it('builds the release patch and clears the pending review state', () => {
    const rel = release(1, { title: 'Discovery', artists: [{ name: 'Daft Punk' }] })
    const t = track({
      reviewMatch: {
        release: rel,
        track: { position: 'A1', title: 'One More Time' },
        result: searchResult(1),
      },
      matchReview: true,
      matchConfidence: 0.7,
    })
    const patch = acceptReviewPatch(t)
    expect(patch?.meta?.title).toBe('One More Time')
    expect(patch?.meta?.album).toBe('Discovery')
    // Leaves the review bucket and is guarded from re-probing, exactly like a hand-picked match.
    expect(patch?.matched).toBe(true)
    expect(patch?.matchReview).toBe(false)
    expect(patch?.reviewMatch).toBeUndefined()
  })

  // No pending suggestion → nothing to accept, so the command that calls this stays a no-op
  // (and its shortcut/enabled gate reads the same undefined).
  it('returns undefined when the track has no review suggestion', () => {
    expect(acceptReviewPatch(track())).toBeUndefined()
  })
})
