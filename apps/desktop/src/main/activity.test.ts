import { describe, expect, it, vi } from 'vitest'
import type { ActivityEvent } from '../shared/types'
import { createActivity } from './activity'

describe('createActivity', () => {
  it('emits start then done around a successful task and returns its value', async () => {
    // The panel needs both edges of every step: a start to show the row immediately
    // (so a slow Discogs call reads as "in progress", not a frozen UI) and a done to
    // resolve it. The wrapped task's value must pass through untouched so instrumenting
    // a call site never changes what it returns.
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))

    const result = await activity.track('discogs', 'activity.searchDiscogs', async () => 42, {
      labelParams: { query: 'bonobo' },
    })

    expect(result).toBe(42)
    expect(events.map((e) => e.phase)).toEqual(['start', 'done'])
    expect(events[0]).toMatchObject({
      kind: 'discogs',
      labelKey: 'activity.searchDiscogs',
      labelParams: { query: 'bonobo' },
    })
    expect(events[0].id).toBe(events[1].id)
  })

  it('derives the done detail key from the result when a summary is given', async () => {
    // The interesting outcome of a search is its result count ("12 resultados"), which
    // only exists once the task resolves — so the done detail is computed from the value.
    // It crosses as a key+params, not finished text, so the panel can translate it.
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))

    await activity.track('discogs', 'activity.searchDiscogs', async () => [1, 2, 3], {
      summary: (r) => ({ detailKey: 'activity.resultCount', detailParams: { count: r.length } }),
    })

    const done = events.find((e) => e.phase === 'done')
    expect(done).toMatchObject({
      detailKey: 'activity.resultCount',
      detailParams: { count: 3 },
    })
  })

  it('lets a summary return a raw detail for untranslatable data like a title', async () => {
    // A release title is data, not UI text — it must pass through verbatim, never keyed.
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))

    await activity.track('discogs', 'activity.loadDiscogsRelease', async () => 'Migration', {
      summary: (title) => ({ detail: title }),
    })

    expect(events.find((e) => e.phase === 'done')?.detail).toBe('Migration')
  })

  it('carries group and groupLabel onto every emitted event so the panel can fold them', async () => {
    // The grouping (analyze sweeps) lives in the renderer reducer, but it can only fold
    // probes that arrive tagged — so the wrapper must stamp group on start AND done.
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))

    await activity.track('analyze', 'activity.probeSpectrogram', async () => 0, {
      group: '/music/kerala.wav',
      groupLabel: 'kerala.wav',
    })

    expect(events).toHaveLength(2)
    for (const e of events) {
      expect(e.group).toBe('/music/kerala.wav')
      expect(e.groupLabel).toBe('kerala.wav')
    }
  })

  it('emits start then error with the raw message when the task throws, and rethrows', async () => {
    // A failed step must stay a failed step for the caller — instrumentation can't
    // swallow the rejection — and the panel's technical detail must carry the raw
    // error so the user (and the dev) can see *why* Discogs failed.
    const activity = createActivity()
    const events: ActivityEvent[] = []
    activity.subscribe((e) => events.push(e))

    await expect(
      activity.track('discogs', 'activity.searchDiscogs', async () => {
        throw new Error('Discogs devolvió 429')
      }),
    ).rejects.toThrow('Discogs devolvió 429')

    expect(events.map((e) => e.phase)).toEqual(['start', 'error'])
    expect(events[1].detail).toContain('Discogs devolvió 429')
  })

  it('gives each tracked task a distinct id so concurrent steps never share a row', async () => {
    // Two searches can overlap (auto-match runs them with concurrency 2); if they shared
    // an id the panel would collapse them onto one row and lose one.
    const activity = createActivity()
    const ids = new Set<string>()
    activity.subscribe((e) => ids.add(e.id))

    await Promise.all([
      activity.track('discogs', 'a', async () => 0),
      activity.track('bandcamp', 'b', async () => 0),
    ])

    // Two tasks × (start+done) collapse to two distinct ids.
    expect(ids.size).toBe(2)
  })

  it('stops delivering to an unsubscribed listener', async () => {
    const activity = createActivity()
    const cb = vi.fn()
    const off = activity.subscribe(cb)
    off()
    await activity.track('cover', 'activity.downloadCover', async () => 0)
    expect(cb).not.toHaveBeenCalled()
  })
})
