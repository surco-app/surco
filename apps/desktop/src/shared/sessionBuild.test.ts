import { describe, expect, it } from 'vitest'
import { camelotDistance } from './camelot'
import type { Combos } from './sessionCombos'
import { type SessionOptions, type SessionPlan, buildSession } from './sessionBuild'
import type { SessionTrack } from './sessionTypes'

function track(id: string, over: Partial<SessionTrack> = {}): SessionTrack {
  return {
    id,
    role: 'any',
    key: null,
    bpm: 140,
    rating: 0,
    plays: 0,
    secs: 300,
    fresh: false,
    title: id,
    artist: 'x',
    ...over,
  }
}

const options = (over: Partial<SessionOptions> = {}): SessionOptions => ({
  minutes: 60,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  freshShare: 0,
  surprise: false,
  seed: 1,
  ...over,
})

function combosOf(...pairs: Array<[string, string, number]>): Combos {
  const map = new Map<string, Map<string, number>>()
  for (const [from, to, strength] of pairs) {
    const next = map.get(from) ?? new Map<string, number>()
    next.set(to, strength)
    map.set(from, next)
  }
  return map
}

const ids = (plan: SessionPlan): string[] => plan.items.map((item) => item.track.id)
const none: Combos = new Map()

describe('buildSession core', () => {
  it('starts from the source of the strongest combo', () => {
    const pool = [track('a'), track('b'), track('c'), track('d')]
    const plan = buildSession(pool, combosOf(['a', 'b', 1], ['c', 'd', 3]), options())
    expect(plan.items[0].track.id).toBe('c')
    expect(plan.items[0].why).toEqual({ kind: 'start' })
  })

  it('follows an unused combo and says how many sets proved it', () => {
    const pool = [track('a'), track('b'), track('c')]
    const plan = buildSession(pool, combosOf(['a', 'b', 2]), options())
    expect(ids(plan).slice(0, 2)).toEqual(['a', 'b'])
    expect(plan.items[1].why).toEqual({ kind: 'combo', sets: 2 })
    expect(plan.summary.combos).toBe(1)
  })

  it('ignores combos when asked not to prefer them', () => {
    const pool = [track('a'), track('b'), track('c')]
    const plan = buildSession(pool, combosOf(['a', 'b', 2]), options({ preferCombos: false }))
    expect(plan.items.some((item) => item.why.kind === 'combo')).toBe(false)
    expect(plan.summary.combos).toBe(0)
  })

  it('never repeats a track and overshoots the requested time by less than one track', () => {
    const pool = Array.from({ length: 10 }, (_, i) => track(`t${i}`))
    const plan = buildSession(pool, none, options({ minutes: 20 }))
    const list = ids(plan)
    expect(new Set(list).size).toBe(list.length)
    expect(plan.summary.secs).toBeGreaterThanOrEqual(1200)
    expect(plan.summary.secs - 300).toBeLessThan(1200)
    expect(plan.summary.shortBySecs).toBe(0)
  })

  it('keeps every keyed transition a neighbour when asked for neighbours', () => {
    const keys = ['8A', '9A', '3B', '8B', '7A', '12A', '9B', '8A', '1A', '2B']
    const pool = keys.map((key, i) => track(`t${i}`, { key }))
    const plan = buildSession(pool, none, options({ harmony: 'neighbours', minutes: 120 }))
    for (let i = 1; i < plan.items.length; i++) {
      const distance = camelotDistance(plan.items[i - 1].track.key, plan.items[i].track.key)
      expect(distance ?? 0).toBeLessThanOrEqual(1)
    }
  })

  it('keeps every keyed transition on the same key when asked for the same key', () => {
    const keys = ['8A', '8A', '8A', '9A', '3B', '8A']
    const pool = keys.map((key, i) => track(`t${i}`, { key }))
    const plan = buildSession(pool, none, options({ harmony: 'same', minutes: 120 }))
    for (let i = 1; i < plan.items.length; i++) {
      expect(camelotDistance(plan.items[i - 1].track.key, plan.items[i].track.key)).toBe(0)
    }
  })

  it('places a track without a key by tempo and does not count it as harmonic', () => {
    const pool = [track('a', { key: '8A', bpm: 140 }), track('b', { key: null, bpm: 141 })]
    const plan = buildSession(pool, combosOf(['a', 'b', 1]), options({ preferCombos: false }))
    const second = plan.items.find((item) => item.track.id === 'b')
    expect(second).toBeDefined()
    expect(plan.summary.withKey).toBe(0)
    expect(plan.summary.harmonic).toBe(0)
  })

  it('gives the same session for the same seed and another for another seed', () => {
    const pool = Array.from({ length: 8 }, (_, i) => track(`t${i}`))
    const first = ids(buildSession(pool, none, options({ seed: 7, minutes: 40 })))
    const again = ids(buildSession(pool, none, options({ seed: 7, minutes: 40 })))
    const other = ids(buildSession(pool, none, options({ seed: 8, minutes: 40 })))
    expect(again).toEqual(first)
    expect(other).not.toEqual(first)
  })

  it('prefers the better rated track among equals and breaks a tie by plays', () => {
    const rated = [track('a'), track('b'), track('c', { rating: 20 }), track('d', { rating: 100 })]
    const byRating = buildSession(rated, combosOf(['a', 'b', 1]), options({ minutes: 30 }))
    expect(ids(byRating)).toEqual(['a', 'b', 'd', 'c'])
    const played = [track('a'), track('b'), track('c', { plays: 5 }), track('d', { plays: 40 })]
    const byPlays = buildSession(played, combosOf(['a', 'b', 1]), options({ minutes: 30 }))
    expect(ids(byPlays)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('ends early and says how much is missing when the pool is too short', () => {
    const pool = [track('a'), track('b'), track('c')]
    const plan = buildSession(pool, none, options({ minutes: 60 }))
    expect(plan.items).toHaveLength(3)
    expect(plan.summary.shortBySecs).toBe(3600 - 900)
  })

  it('assumes six minutes for a track with no duration and counts the guesses', () => {
    const pool = Array.from({ length: 5 }, (_, i) => track(`t${i}`, { secs: 0 }))
    const plan = buildSession(pool, none, options({ minutes: 10 }))
    expect(plan.items).toHaveLength(2)
    expect(plan.summary.secs).toBe(720)
    expect(plan.summary.missingDurations).toBe(2)
  })

  it('widens the tempo window to 8 and records it when nothing fits within 4', () => {
    const pool = [track('a', { bpm: 140 }), track('b', { bpm: 147 })]
    const plan = buildSession(pool, none, options({ preferCombos: false, minutes: 10, seed: 3 }))
    const second = plan.items[1]
    expect(second.why).toEqual({ kind: 'bpm', relaxed: true })
  })

  it('does not break on an empty pool', () => {
    const plan = buildSession([], none, options())
    expect(plan.items).toEqual([])
    expect(plan.summary.tracks).toBe(0)
  })
})
