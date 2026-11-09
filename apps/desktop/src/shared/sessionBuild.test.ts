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
  playSecs: 3600,
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

describe('buildSession alternation, new tracks and surprise', () => {
  it('never puts two tracks of the same role in a row and lets any stay neutral', () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => track(`b${i}`, { role: 'base' })),
      ...Array.from({ length: 5 }, (_, i) => track(`v${i}`, { role: 'vocal' })),
      track('x1', { role: 'any' }),
      track('x2', { role: 'any' }),
    ]
    const plan = buildSession(pool, none, options({ alternate: true, minutes: 120, seed: 4 }))
    expect(plan.items.length).toBeGreaterThan(3)
    let last: string | null = null
    for (const item of plan.items) {
      if (item.track.role === 'any') continue
      expect(item.track.role).not.toBe(last)
      last = item.track.role
    }
  })

  it('lets an any track reached by a proven combo take the place of the role that was due', () => {
    const pool = [
      track('b1', { role: 'base' }),
      track('x', { role: 'any' }),
      track('v1', { role: 'vocal' }),
      track('b2', { role: 'base', rating: 100 }),
    ]
    const plan = buildSession(
      pool,
      combosOf(['b1', 'x', 2]),
      options({ alternate: true, minutes: 30 }),
    )
    expect(ids(plan)).toEqual(['b1', 'x', 'b2', 'v1'])
  })

  it('skips a combo that would break the alternation', () => {
    const pool = [
      track('a', { role: 'base' }),
      track('b', { role: 'base' }),
      track('c', { role: 'vocal' }),
    ]
    const plan = buildSession(
      pool,
      combosOf(['a', 'b', 3]),
      options({ alternate: true, minutes: 30 }),
    )
    expect(ids(plan)).toEqual(['a', 'c', 'b'])
  })

  it('places roughly the requested share of new tracks, never first or last', () => {
    const normal = Array.from({ length: 30 }, (_, i) => track(`n${i}`))
    const fresh = Array.from({ length: 6 }, (_, i) => track(`f${i}`, { fresh: true }))
    const plan = buildSession(
      [...normal, ...fresh],
      none,
      options({ minutes: 100, freshShare: 0.15, seed: 2 }),
    )
    const placed = plan.items.filter((item) => item.track.fresh).length
    expect(placed).toBeGreaterThanOrEqual(1)
    expect(placed).toBeLessThanOrEqual(4)
    expect(plan.summary.fresh).toBe(placed)
    expect(plan.items[0].track.fresh).toBe(false)
    expect(plan.items[plan.items.length - 1].track.fresh).toBe(false)
  })

  it('places no new track when none is asked for', () => {
    const pool = [track('a'), track('b'), track('f', { fresh: true })]
    const plan = buildSession(pool, none, options({ freshShare: 0 }))
    expect(plan.summary.fresh).toBe(0)
    expect(ids(plan)).not.toContain('f')
  })

  it('lets a combo win the slot of a new track and moves the new one to the next slot', () => {
    const pool = [
      ...['a', 'b', 'c', 'd', 'e'].map((id) => track(id)),
      track('f1', { fresh: true }),
      track('f2', { fresh: true }),
    ]
    const plan = buildSession(
      pool,
      combosOf(['a', 'b', 1]),
      options({ minutes: 20, freshShare: 0.4 }),
    )
    expect(plan.items[1].track.id).toBe('b')
    expect(plan.items[1].why).toEqual({ kind: 'combo', sets: 1 })
    expect(plan.items[2].track.fresh).toBe(true)
    expect(plan.items[0].track.fresh).toBe(false)
  })

  it('fits a new track by role like any other track', () => {
    const pool = [
      track('a', { role: 'base' }),
      track('x', { role: 'vocal' }),
      track('fb', { role: 'base', fresh: true }),
      track('fv', { role: 'vocal', fresh: true }),
    ]
    const plan = buildSession(
      pool,
      combosOf(['a', 'x', 1]),
      options({ alternate: true, minutes: 20, freshShare: 0.5 }),
    )
    expect(ids(plan)).toEqual(['a', 'x', 'fb'])
    expect(plan.items[2].why).toEqual({ kind: 'fresh', key: null, role: 'base' })
  })

  it('leaves room for a pair that never had a combo when surprise is on', () => {
    const chain = Array.from({ length: 10 }, (_, i) => track(`t${i}`))
    const links: Array<[string, string, number]> = chain
      .slice(0, -1)
      .map((t, i) => [t.id, chain[i + 1].id, i === 0 ? 2 : 1])
    const plain = buildSession(chain, combosOf(...links), options({ minutes: 60 }))
    const surprising = buildSession(
      chain,
      combosOf(...links),
      options({ minutes: 60, surprise: true }),
    )
    expect(plain.summary.combos).toBe(plain.items.length - 1)
    expect(surprising.summary.combos).toBeLessThan(surprising.items.length - 1)
  })
})
