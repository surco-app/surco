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
  alternate: true,
  freshShare: 0,
  surprise: false,
  seed: 1,
  ...over,
})

const none = new Map<string, Map<string, number>>()
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]

describe('buildSession keeps the roles alternating before it keeps the tempo', () => {
  const far = [
    ...Array.from({ length: 10 }, (_, i) => track(`b${i}`, { role: 'base', bpm: 140 })),
    ...Array.from({ length: 10 }, (_, i) => track(`v${i}`, { role: 'vocal', bpm: 160 })),
  ]

  it('goes from base to vocal even when every vocal is far in tempo', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(far, none, options({ seed }))
      const roles = plan.items.map((item) => item.track.role)
      expect(roles.length).toBeGreaterThan(4)
      for (let i = 1; i < roles.length; i++)
        expect(roles[i], `seed ${seed} at ${i}`).not.toBe(roles[i - 1])
    }
  })

  it('says the tempo moved more than usual when it kept the role at that price', () => {
    const plan = buildSession(far, none, options())
    const jump = plan.items.find(
      (item, i) => i > 0 && item.track.role !== plan.items[i - 1].track.role,
    )
    expect(jump?.why).toEqual({ kind: 'bpm', relaxed: true })
  })

  it('takes the closest tempo of the role that is needed when none is near', () => {
    const pool = [
      track('start', { role: 'base', bpm: 140 }),
      track('near', { role: 'vocal', bpm: 152 }),
      track('farther', { role: 'vocal', bpm: 165 }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 10, seed }))
      const ids = plan.items.map((item) => item.track.id)
      if (ids[0] === 'start') expect(ids[1]).toBe('near')
    }
  })

  it('still lets a track with no tempo come before one that is far, as before', () => {
    const pool = [
      track('start', { role: 'base', bpm: 140 }),
      track('unknown', { role: 'vocal', bpm: 0 }),
      track('far', { role: 'vocal', bpm: 170 }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 10, seed }))
      const ids = plan.items.map((item) => item.track.id)
      if (ids[0] === 'start') expect(ids[1]).toBe('unknown')
    }
  })

  it('keeps the roles alternating before the harmony, since the DJ wants base and vocal in turn above all', () => {
    const pool = [
      track('start', { role: 'base', bpm: 140, key: '8A' }),
      track('wrongKey', { role: 'vocal', bpm: 140, key: '2A' }),
      track('base2', { role: 'base', bpm: 140, key: '8A' }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 10, harmony: 'same', seed }))
      const roles = plan.items.map((item) => item.track.role)
      expect(roles.slice(0, 2)).toEqual(['vocal', 'base'])
    }
  })

  it('does not bring a far newcomer next to a track just to fill a slot for new tracks', () => {
    const pool = [
      ...Array.from({ length: 6 }, (_, i) => track(`k${i}`, { role: 'base', bpm: 140 })),
      track('farNew', { role: 'base', bpm: 175, fresh: true }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ alternate: false, freshShare: 0.4, seed }))
      expect(plan.items.some((item) => item.track.id === 'farNew')).toBe(false)
    }
  })
})

const roleList = (ids: string[], role: 'base' | 'vocal' | 'any', prefix: string, bpm = 140) =>
  ids.map((id) => track(`${prefix}${id}`, { role, bpm }))
const six = ['0', '1', '2', '3', '4', '5']

describe('buildSession while both bases and vocals are known', () => {
  const pool = [
    ...roleList(six, 'base', 'b'),
    ...roleList(six, 'vocal', 'v'),
    ...roleList([...six, '6', '7', '8', '9'], 'any', 'n'),
  ]

  it('leaves the tracks that have no role out of the plan, so the roles alternate all the way', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ seed }))
      const roles = plan.items.map((item) => item.track.role)
      expect(
        roles.every((role) => role !== 'any'),
        `seed ${seed}`,
      ).toBe(true)
      for (let i = 1; i < roles.length; i++) expect(roles[i]).not.toBe(roles[i - 1])
    }
  })

  it('starts from a track with a role', () => {
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ seed }))
      expect(plan.items[0].track.role).not.toBe('any')
    }
  })

  it('brings in a track with no role, in the place of the missing role, before repeating the other one', () => {
    const lean = [
      ...roleList(['0', '1', '2', '3', '4', '5', '6', '7'], 'base', 'b'),
      ...roleList(['0'], 'vocal', 'v'),
      ...roleList(['0', '1', '2', '3', '4', '5', '6', '7'], 'any', 'n'),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(lean, none, options({ seed, minutes: 120 }))
      const roles = plan.items.map((item) => item.track.role)
      for (let i = 1; i < roles.length; i++) {
        expect(roles[i] === 'base' && roles[i - 1] === 'base', `seed ${seed} at ${i}`).toBe(false)
      }
    }
  })

  it('takes a track with no role when a combo seen in two sets says it goes next', () => {
    const combos = new Map([['v0', new Map([['n0', 2]])]])
    const plan = buildSession(pool, combos, options({ preferCombos: true, seed: 3 }))
    const at = plan.items.findIndex((item) => item.track.id === 'v0')
    if (at >= 0 && at < plan.items.length - 1) {
      expect(plan.items[at + 1].track.id).toBe('n0')
      expect(plan.items[at + 1].why).toEqual({ kind: 'combo', sets: 2 })
    }
  })

  it('lets that track take the place of a base, so a vocal follows it', () => {
    const combos = new Map([['v0', new Map([['n0', 2]])]])
    for (const seed of SEEDS) {
      const plan = buildSession(pool, combos, options({ preferCombos: true, seed }))
      const at = plan.items.findIndex((item) => item.track.id === 'n0')
      if (at > 0 && at < plan.items.length - 1) expect(plan.items[at + 1].track.role).toBe('vocal')
    }
  })

  it('does not take a track with no role for a pair seen in a single set', () => {
    const combos = new Map([['v0', new Map([['n0', 1]])]])
    for (const seed of SEEDS) {
      const plan = buildSession(pool, combos, options({ preferCombos: true, seed }))
      expect(plan.items.some((item) => item.track.role === 'any')).toBe(false)
    }
  })
})

describe('buildSession when only one role is known', () => {
  it('keeps using the tracks with no role as filler, as there is nothing to alternate', () => {
    const pool = [...roleList(six, 'base', 'b'), ...roleList(six, 'any', 'n')]
    const plan = buildSession(pool, none, options({ minutes: 60 }))
    expect(plan.items.some((item) => item.track.role === 'any')).toBe(true)
    expect(plan.items).toHaveLength(12)
  })

  it('keeps using them when alternating is off', () => {
    const pool = [
      ...roleList(six, 'base', 'b'),
      ...roleList(six, 'vocal', 'v'),
      ...roleList(six, 'any', 'n'),
    ]
    const used = new Set<string>()
    for (const seed of SEEDS) {
      for (const item of buildSession(pool, none, options({ alternate: false, seed, minutes: 80 }))
        .items)
        used.add(item.track.role)
    }
    expect(used.has('any')).toBe(true)
  })
})
