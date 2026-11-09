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

  it('keeps the harmony the user asked for, even if that costs a repeated role', () => {
    const pool = [
      track('start', { role: 'base', bpm: 140, key: '8A' }),
      track('wrongKey', { role: 'vocal', bpm: 140, key: '2A' }),
      track('base2', { role: 'base', bpm: 140, key: '8A' }),
    ]
    for (const seed of SEEDS) {
      const plan = buildSession(pool, none, options({ minutes: 10, harmony: 'same', seed }))
      const ids = plan.items.map((item) => item.track.id)
      if (ids.includes('wrongKey')) expect(ids).toEqual(['wrongKey'])
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
