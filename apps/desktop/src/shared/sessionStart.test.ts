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
  playSecs: 3600,
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
const SEEDS = [1, 2, 3, 4, 5, 6]
const pool = Array.from({ length: 30 }, (_, i) => track(`t${i}`))

describe('buildSession starting with a track the user picked', () => {
  it('opens with that track whatever the seed', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ seed, startWith: 't7' }))
      expect(plan.items[0].track.id, `seed ${seed}`).toBe('t7')
    }
  })

  it('opens with it even when combos would have started somewhere else', () => {
    const pairs = new Map([['t1', new Map([['t2', 3]])]])
    const plan = buildSession(pool, pairs, options({ preferCombos: true, startWith: 't7' }))
    expect(plan.items[0].track.id).toBe('t7')
  })

  it('says the opening track was chosen by the user', () => {
    const plan = buildSession(pool, none, options({ startWith: 't7' }))
    expect(plan.items[0].why).toEqual({ kind: 'chosen' })
  })

  it('never plays it a second time and still fills the time', () => {
    const plan = buildSession(pool, none, options({ startWith: 't7' }))
    expect(plan.items.filter((item) => item.track.id === 't7')).toHaveLength(1)
    expect(plan.items.length).toBeGreaterThan(5)
  })

  it('opens with a track that has no role even when the roles alternate', () => {
    const roled = [
      ...Array.from({ length: 10 }, (_, i) => track(`b${i}`, { role: 'base' })),
      ...Array.from({ length: 10 }, (_, i) => track(`v${i}`, { role: 'vocal' })),
      track('n0'),
    ]
    const plan = buildSession(roled, none, options({ alternate: true, startWith: 'n0' }))
    expect(plan.items[0].track.id).toBe('n0')
  })

  it('starts as usual when the track is not in the pool', () => {
    const plan = buildSession(pool, none, options({ startWith: 'gone' }))
    expect(plan.items.map((item) => item.track.id)).not.toContain('gone')
    expect(plan.items[0].why).toEqual({ kind: 'start' })
  })
})
