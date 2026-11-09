import { describe, expect, it } from 'vitest'
import { buildSession, type SessionOptions } from './sessionBuild'
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
  minutes: 15,
  playSecs: 3600,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: true,
  freshShare: 0,
  surprise: false,
  seed: 1,
  ...over,
})

const pairs = (...list: Array<[string, string, number]>) => {
  const map = new Map<string, Map<string, number>>()
  for (const [from, to, strength] of list) {
    const next = map.get(from) ?? new Map<string, number>()
    next.set(to, strength)
    map.set(from, next)
  }
  return map
}

const pool = (over: Partial<Record<string, Partial<SessionTrack>>> = {}): SessionTrack[] => [
  track('v0', { role: 'vocal', ...over.v0 }),
  track('b0', { role: 'base', ...over.b0 }),
  track('b1', { role: 'base', ...over.b1 }),
  track('b2', { role: 'base', ...over.b2 }),
  track('v1', { role: 'vocal', ...over.v1 }),
  track('v2', { role: 'vocal', ...over.v2 }),
]

const SEEDS = [1, 2, 3, 4, 5, 6]

describe('buildSession preferring the track that followed another in a set', () => {
  it('takes the track of the role that is due that followed it once, and says so', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool(), pairs(['v0', 'b2', 1]), options({ seed }))
      const at = plan.items.findIndex((item) => item.track.id === 'v0')
      if (at >= 0 && at < plan.items.length - 1) {
        expect(plan.items[at + 1].track.id, `seed ${seed}`).toBe('b2')
        expect(plan.items[at + 1].why).toEqual({ kind: 'partner' })
      }
    }
  })

  it('takes the pair seen in more sets when it can pick between two', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool(), pairs(['v0', 'b1', 1], ['v0', 'b2', 2]), options({ seed }))
      const at = plan.items.findIndex((item) => item.track.id === 'v0')
      if (at >= 0 && at < plan.items.length - 1) {
        expect(plan.items[at + 1].track.id).toBe('b2')
        expect(plan.items[at + 1].why).toEqual({ kind: 'combo', sets: 2 })
      }
    }
  })

  it('does not take it when its tempo is far from the track before', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(
        pool({ b2: { bpm: 165 } }),
        pairs(['v0', 'b2', 1]),
        options({ seed }),
      )
      const at = plan.items.findIndex((item) => item.track.id === 'v0')
      if (at >= 0 && at < plan.items.length - 1)
        expect(plan.items[at + 1].why.kind).not.toBe('partner')
    }
  })

  it('does not take it when it breaks the harmony that was asked for', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(
        pool({ v0: { key: '8A' }, b2: { key: '2A' }, b0: { key: '8A' }, b1: { key: '8A' } }),
        pairs(['v0', 'b2', 1]),
        options({ seed, harmony: 'same' }),
      )
      const at = plan.items.findIndex((item) => item.track.id === 'v0')
      if (at >= 0 && at < plan.items.length - 1)
        expect(plan.items[at + 1].why.kind).not.toBe('partner')
    }
  })

  it('does not take it when it has the same role as the track before, which would break the alternation', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool(), pairs(['v0', 'v1', 1]), options({ seed }))
      const roles = plan.items.map((item) => item.track.role)
      for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1])
    }
  })

  it('does not take a track with no role for a pair seen once', () => {
    const withNeutral = [...pool(), track('n0', { role: 'any' })]
    for (const seed of SEEDS) {
      const plan = buildSession(withNeutral, pairs(['v0', 'n0', 1]), options({ seed }))
      expect(plan.items.some((item) => item.track.id === 'n0')).toBe(false)
    }
  })

  it('leaves it alone when combos are not wanted', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(
        pool(),
        pairs(['v0', 'b2', 1]),
        options({ seed, preferCombos: false }),
      )
      expect(plan.items.some((item) => item.why.kind === 'partner')).toBe(false)
    }
  })

  it('does not count it as a combo in the summary', () => {
    const plan = buildSession(pool(), pairs(['v0', 'b2', 1]), options({ seed: 1 }))
    expect(plan.summary.combos).toBe(plan.items.filter((item) => item.why.kind === 'combo').length)
  })
})
