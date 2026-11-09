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
  minutes: 60,
  preferCombos: false,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  freshShare: 0,
  surprise: false,
  seed: 1,
  ...over,
})

const none = new Map<string, Map<string, number>>()
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('buildSession when alternation has nothing of the other role', () => {
  it('goes on with the role it has instead of stopping after one track', () => {
    const bases = Array.from({ length: 20 }, (_, i) => track(`b${i}`, { role: 'base' }))
    const plan = buildSession(bases, none, options({ alternate: true, minutes: 60 }))
    expect(plan.items).toHaveLength(12)
    expect(plan.summary.shortBySecs).toBe(0)
  })

  it('still alternates while both roles are there', () => {
    const pool = [
      ...Array.from({ length: 4 }, (_, i) => track(`b${i}`, { role: 'base' })),
      ...Array.from({ length: 4 }, (_, i) => track(`v${i}`, { role: 'vocal' })),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ alternate: true, minutes: 40, seed }))
      const roles = plan.items.map((item) => item.track.role)
      for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1])
    }
  })

  it('uses up the other role first and only then goes on with what is left', () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => track(`b${i}`, { role: 'base' })),
      track('v0', { role: 'vocal' }),
    ]
    const plan = buildSession(pool, none, options({ alternate: true, minutes: 30 }))
    expect(plan.items).toHaveLength(6)
    expect(plan.items.some((item) => item.track.id === 'v0')).toBe(true)
  })
})

describe('buildSession with tracks that carry no data', () => {
  it('leaves a track with no tempo and no key for last, behind any track with a tempo', () => {
    const pool = [
      track('a', { bpm: 140, key: '3B' }),
      track('far', { bpm: 146, key: '9A' }),
      track('nodata', { bpm: 0, key: null }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 15, seed }))
      expect(plan.items.map((item) => item.track.id).at(-1)).toBe('nodata')
    }
  })

  it('puts a track with an unknown key after the ones whose key is known', () => {
    const pool = [
      track('here', { key: '8A' }),
      track('known', { key: '2A' }),
      track('unknown', { key: null }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 15, seed }))
      expect(plan.items.map((item) => item.track.id).at(-1)).toBe('unknown')
    }
  })

  it('never opens the session with a track that has no data while others have it', () => {
    const pool = [track('nodata', { bpm: 0, key: null }), track('a', { key: '8A' })]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 5, seed }))
      expect(plan.items[0].track.id).toBe('a')
    }
  })

  it('still builds from a library with no data at all', () => {
    const pool = Array.from({ length: 4 }, (_, i) => track(`n${i}`, { bpm: 0, key: null }))
    const plan = buildSession(pool, none, options({ minutes: 20 }))
    expect(plan.items.length).toBeGreaterThan(0)
  })
})
