import { describe, expect, it } from 'vitest'
import { buildSession, type SessionOptions } from './sessionBuild'
import type { SessionTrack, TrackRole } from './sessionTypes'

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
const many = (count: number, over: Partial<SessionTrack> = {}) =>
  Array.from({ length: count }, (_, i) => track(`t${i}`, over))
const ids = (plan: ReturnType<typeof buildSession>) => plan.items.map((item) => item.track.id)

describe('buildSession with pinned tracks', () => {
  const pool = many(30)
  const first = buildSession(pool, none, options({ seed: 1 }))
  const length = first.items.length

  it('keeps a pinned track at its position and keeps the length', () => {
    const pinned = [{ index: 3, trackId: ids(first)[3] }]
    for (const seed of SEEDS) {
      const plan = buildSession(
        pool,
        none,
        options({ seed: seed + 10, pinned, fixedLength: length }),
      )
      expect(plan.items[3].track.id, `seed ${seed}`).toBe(ids(first)[3])
      expect(plan.items).toHaveLength(length)
    }
  })

  it('keeps several pinned tracks, each at its own position', () => {
    const pinned = [
      { index: 0, trackId: ids(first)[0] },
      { index: 5, trackId: ids(first)[5] },
      { index: length - 1, trackId: ids(first)[length - 1] },
    ]
    const plan = buildSession(pool, none, options({ seed: 9, pinned, fixedLength: length }))
    expect(plan.items[0].track.id).toBe(ids(first)[0])
    expect(plan.items[5].track.id).toBe(ids(first)[5])
    expect(plan.items[length - 1].track.id).toBe(ids(first)[length - 1])
  })

  it('draws the other positions again', () => {
    const pinned = [{ index: 3, trackId: ids(first)[3] }]
    const plan = buildSession(pool, none, options({ seed: 77, pinned, fixedLength: length }))
    const same = plan.items.filter((item, i) => item.track.id === ids(first)[i]).length
    expect(same).toBeLessThan(length)
  })

  it('never puts a pinned track in a second place', () => {
    const pinned = [{ index: 4, trackId: ids(first)[4] }]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ seed, pinned, fixedLength: length }))
      expect(ids(plan).filter((id) => id === ids(first)[4])).toHaveLength(1)
    }
  })

  it('says the pinned tracks were chosen by the user', () => {
    const pinned = [{ index: 2, trackId: ids(first)[2] }]
    const plan = buildSession(pool, none, options({ seed: 5, pinned, fixedLength: length }))
    expect(plan.items[2].why).toEqual({ kind: 'chosen' })
  })

  it('can start from a pinned track', () => {
    const pinned = [{ index: 0, trackId: 't7' }]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ seed, pinned, fixedLength: length }))
      expect(plan.items[0].track.id).toBe('t7')
    }
  })

  it('ignores a pin whose track is not in the pool', () => {
    const plan = buildSession(
      pool,
      none,
      options({ pinned: [{ index: 2, trackId: 'gone' }], fixedLength: length }),
    )
    expect(ids(plan)).not.toContain('gone')
    expect(plan.items).toHaveLength(length)
  })

  it('ignores a pin beyond the length asked for', () => {
    const plan = buildSession(
      pool,
      none,
      options({ pinned: [{ index: 99, trackId: 't3' }], fixedLength: 6 }),
    )
    expect(plan.items.map((item) => item.track.id)).not.toContain('t3')
  })

  it('still places the pinned tracks when the pool has too few others to fill every position', () => {
    const tiny = many(4)
    const pinned = [
      { index: 0, trackId: 't0' },
      { index: 7, trackId: 't1' },
    ]
    const plan = buildSession(tiny, none, options({ pinned, fixedLength: 8 }))
    expect(ids(plan)).toContain('t0')
    expect(ids(plan)).toContain('t1')
  })

  it('builds as before when nothing is pinned', () => {
    const plain = buildSession(pool, none, options({ seed: 3 }))
    const empty = buildSession(pool, none, options({ seed: 3, pinned: [], fixedLength: 5 }))
    expect(ids(empty)).toEqual(ids(plain))
  })
})

describe('buildSession keeping the roles alternating around a pinned track', () => {
  const roleOf = (i: number): TrackRole => (i % 2 === 0 ? 'base' : 'vocal')
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => track(`b${i}`, { role: 'base' })),
    ...Array.from({ length: 20 }, (_, i) => track(`v${i}`, { role: 'vocal' })),
  ]

  it('does not put the role of the pinned track right before it', () => {
    for (const seed of SEEDS) {
      const pinned = [{ index: 4, trackId: 'v3' }]
      const plan = buildSession(
        pool,
        none,
        options({ seed, alternate: true, pinned, fixedLength: 10 }),
      )
      const roles = plan.items.map((item) => item.track.role)
      for (let i = 1; i < roles.length; i++)
        expect(roles[i], `seed ${seed} at ${i}`).not.toBe(roles[i - 1])
    }
    expect(roleOf(0)).toBe('base')
  })

  it('also holds with a pin at the very start and another at the end', () => {
    for (const seed of SEEDS) {
      const pinned = [
        { index: 0, trackId: 'b2' },
        { index: 9, trackId: 'v5' },
      ]
      const plan = buildSession(
        pool,
        none,
        options({ seed, alternate: true, pinned, fixedLength: 10 }),
      )
      const roles = plan.items.map((item) => item.track.role)
      for (let i = 1; i < roles.length; i++)
        expect(roles[i], `seed ${seed} at ${i}`).not.toBe(roles[i - 1])
    }
  })
})

describe('buildSession keeps pinned tracks in place when a slot has no track in key', () => {
  it('fills the slot with a track out of key rather than moving the pinned one forward', () => {
    const pool = [
      track('a', { key: '8A' }),
      track('b', { key: '1A' }),
      track('c', { key: '5A' }),
      track('d', { key: '3B' }),
      track('e', { key: '8A' }),
      track('f', { key: '10A' }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(
        pool,
        none,
        options({ harmony: 'same', seed, pinned: [{ index: 3, trackId: 'd' }], fixedLength: 6 }),
      )
      expect(plan.items[3]?.track.id, `seed ${seed}`).toBe('d')
    }
  })
})
