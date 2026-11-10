import { describe, expect, it } from 'vitest'
import type { Combos } from './sessionCombos'
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
    artist: id,
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

function combosOf(...pairs: Array<[string, string, number]>): Combos {
  const map = new Map<string, Map<string, number>>()
  for (const [from, to, strength] of pairs) {
    const next = map.get(from) ?? new Map<string, number>()
    next.set(to, strength)
    map.set(from, next)
  }
  return map
}

const none: Combos = new Map()
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1)

function tally(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

describe('buildSession gives a different session each time it is redone', () => {
  const liked = Array.from({ length: 30 }, (_, i) => track(`t${i}`, { plays: i + 1 }))

  it('changes most of the tracks between two seeds when every track is liked differently', () => {
    const first = new Set(
      buildSession(liked, none, options({ minutes: 50, seed: 1 })).items.map((i) => i.track.id),
    )
    const other = buildSession(liked, none, options({ minutes: 50, seed: 2 })).items.map(
      (i) => i.track.id,
    )
    const shared = other.filter((id) => first.has(id)).length
    expect(shared / other.length).toBeLessThan(0.8)
  })

  it('still plays a well liked track more often than one nobody played', () => {
    const pool = [
      track('start', { rating: 100 }),
      track('loved', { rating: 100, plays: 40 }),
      track('plain'),
    ]
    const seconds = SEEDS.map(
      (seed) =>
        buildSession(pool, none, options({ minutes: 10, seed, startWith: 'start' })).items[1].track
          .id,
    )
    const counts = tally(seconds)
    expect(counts.get('loved') ?? 0).toBeGreaterThan(2 * (counts.get('plain') ?? 0))
    expect(counts.get('plain') ?? 0).toBeGreaterThan(0)
  })

  it('lets the key count even when taste is weighed', () => {
    const pool = [
      track('start', { key: '8A' }),
      track('near', { key: '8A', plays: 10 }),
      track('clash', { key: '2B', plays: 11 }),
    ]
    const seconds = SEEDS.map(
      (seed) =>
        buildSession(pool, none, options({ minutes: 10, seed, startWith: 'start' })).items[1].track
          .id,
    )
    const counts = tally(seconds)
    expect(counts.get('near') ?? 0).toBeGreaterThan(counts.get('clash') ?? 0)
  })

  it('opens from more than one proven combo across seeds, most often the strongest', () => {
    const pool = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => track(id))
    const combos = combosOf(['a', 'b', 4], ['c', 'd', 2], ['e', 'f', 2])
    const openings = tally(
      SEEDS.map(
        (seed) =>
          buildSession(pool, combos, options({ preferCombos: true, minutes: 10, seed })).items[0]
            .track.id,
      ),
    )
    expect(openings.size).toBeGreaterThan(1)
    expect(openings.get('a') ?? 0).toBeGreaterThan(openings.get('c') ?? 0)
  })
})

describe('buildSession spreads the new tracks', () => {
  it('never plays two new tracks in a row when a run of combos kept their slots', () => {
    const chain = Array.from({ length: 16 }, (_, i) => track(`k${i}`))
    const links = chain
      .slice(0, -1)
      .map((t, i): [string, string, number] => [t.id, chain[i + 1].id, 2])
    const rest = Array.from({ length: 20 }, (_, i) => track(`r${i}`))
    const fresh = Array.from({ length: 10 }, (_, i) => track(`f${i}`, { fresh: true }))
    for (const seed of SEEDS.slice(0, 40)) {
      const plan = buildSession(
        [...chain, ...rest, ...fresh],
        combosOf(...links),
        options({ minutes: 180, freshShare: 0.3, preferCombos: true, seed, startWith: 'k0' }),
      )
      for (let i = 1; i < plan.items.length; i++)
        expect(
          plan.items[i - 1].track.fresh && plan.items[i].track.fresh,
          `seed ${seed} at ${i}`,
        ).toBe(false)
    }
  })
})
