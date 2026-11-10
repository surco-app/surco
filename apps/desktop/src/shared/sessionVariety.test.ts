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

describe('buildSession warms up', () => {
  const pool = Array.from({ length: 120 }, (_, i) => track(`t${i}`, { bpm: 130 + (i % 21) }))
  const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length

  it('plays faster at the end than at the start, the way a set climbs', () => {
    let rise = 0
    for (const seed of SEEDS.slice(0, 40)) {
      const bpms = buildSession(
        pool,
        none,
        options({ minutes: 120, playSecs: 120, seed }),
      ).items.map((item) => item.track.bpm)
      const third = Math.floor(bpms.length / 3)
      rise += mean(bpms.slice(-third)) - mean(bpms.slice(0, third))
    }
    expect(rise / 40).toBeGreaterThan(4)
  })

  it('opens near the slow end of what was chosen', () => {
    const openings = SEEDS.slice(0, 40).map(
      (seed) => buildSession(pool, none, options({ minutes: 30, seed })).items[0].track.bpm,
    )
    expect(mean(openings)).toBeLessThan(138)
  })
})

describe('buildSession plays each song once and spaces an artist', () => {
  it('never plays the same song twice from two files', () => {
    const pool = [
      track('a.mp3', { song: 'x|pray', acts: ['x'] }),
      track('a.flac', { song: 'x|pray', acts: ['x'] }),
      track('b', { song: 'y|b', acts: ['y'] }),
      track('c', { song: 'z|c', acts: ['z'] }),
    ]
    for (const seed of SEEDS.slice(0, 40)) {
      const songs = buildSession(pool, none, options({ minutes: 60, seed })).items.map(
        (item) => item.track.song,
      )
      expect(new Set(songs).size, `seed ${seed}`).toBe(songs.length)
    }
  })

  it('puts the same artist twice in a row less often than another artist', () => {
    const pool = [
      track('start', { acts: ['solo'] }),
      track('same', { acts: ['solo'] }),
      track('other', { acts: ['else'] }),
    ]
    const seconds = SEEDS.map(
      (seed) =>
        buildSession(pool, none, options({ minutes: 10, seed, startWith: 'start' })).items[1].track
          .id,
    )
    const counts = tally(seconds)
    expect(counts.get('other') ?? 0).toBeGreaterThan(2 * (counts.get('same') ?? 0))
  })
})

describe('buildSession says a track was picked for taste only when it was among the best', () => {
  it('never calls a track one of the best liked when most of what fitted was liked more', () => {
    const pool = [
      track('start', { rating: 100, plays: 50 }),
      track('meh', { plays: 1 }),
      ...Array.from({ length: 3 }, (_, i) => track(`top${i}`, { rating: 100, plays: 40 + i })),
    ]
    const picked = SEEDS.flatMap((seed) =>
      buildSession(pool, none, options({ minutes: 10, seed, startWith: 'start' })).items.filter(
        (item) => item.track.id === 'meh',
      ),
    )
    expect(picked.length).toBeGreaterThan(0)
    for (const item of picked) expect(item.why.kind).not.toBe('taste')
  })
})

describe('buildSession mixes the way the DJ mixes', () => {
  it('reads a jump past the learned usual window as a wider one', () => {
    const pool = [track('a', { bpm: 140 }), track('b', { bpm: 143 })]
    const stock = buildSession(pool, none, options({ minutes: 10, startWith: 'a' }))
    const learned = buildSession(
      pool,
      none,
      options({ minutes: 10, startWith: 'a', tempoTight: 2, tempoWide: 4 }),
    )
    expect(stock.items[1].why).not.toEqual({ kind: 'bpm', relaxed: true })
    expect(learned.items[1].why).toEqual({ kind: 'bpm', relaxed: true })
  })

  it('lets the key weigh nothing for a DJ whose sets ignore it', () => {
    const pool = [
      track('start', { key: '8A' }),
      track('near', { key: '8A' }),
      track('clash', { key: '2B' }),
    ]
    const seconds = SEEDS.map(
      (seed) =>
        buildSession(pool, none, options({ minutes: 10, seed, startWith: 'start', keyCare: 0 }))
          .items[1].track.id,
    )
    const counts = tally(seconds)
    const ratio = (counts.get('near') ?? 0) / (counts.get('clash') ?? 1)
    expect(ratio).toBeGreaterThan(0.7)
    expect(ratio).toBeLessThan(1.4)
  })
})

describe('buildSession gives each part of the set its tracks', () => {
  const plain = Array.from({ length: 60 }, (_, i) => track(`p${i}`))
  const openers = Array.from({ length: 6 }, (_, i) => track(`o${i}`, { phase: 'open' }))
  const closers = Array.from({ length: 6 }, (_, i) => track(`c${i}`, { phase: 'close' }))
  const pool = [...plain, ...openers, ...closers]
  const runs = SEEDS.slice(0, 60).map(
    (seed) => buildSession(pool, none, options({ minutes: 60, playSecs: 120, seed })).items,
  )

  it('opens with a warm-up track more often than chance, without forcing it', () => {
    const opened = runs.filter((items) => items[0].track.phase === 'open').length
    const chance = openers.length / pool.length
    expect(opened / runs.length).toBeGreaterThan(2 * chance)
    expect(opened).toBeLessThan(runs.length)
  })

  it('keeps the closing tracks for the end and the warm-up ones for the start', () => {
    let closingLate = 0
    let closingEarly = 0
    let openingLate = 0
    for (const items of runs) {
      const cut = Math.floor(items.length * 0.75)
      closingLate += items.slice(cut).filter((item) => item.track.phase === 'close').length
      closingEarly += items.slice(0, cut).filter((item) => item.track.phase === 'close').length
      openingLate += items.slice(cut).filter((item) => item.track.phase === 'open').length
    }
    expect(closingLate).toBeGreaterThan(3 * closingEarly)
    expect(openingLate).toBeLessThan(closingLate / 3)
  })

  it('says why a track opens or closes the set', () => {
    const kinds = runs.flatMap((items) =>
      items.filter((item) => item.track.phase === 'close').map((item) => item.why),
    )
    expect(kinds).toContainEqual({ kind: 'phase', phase: 'close' })
  })

  it('plays the tracks the DJ always plays more often than the rest', () => {
    const must = Array.from({ length: 10 }, (_, i) => track(`m${i}`, { must: true }))
    const counts = { must: 0, plain: 0 }
    for (const seed of SEEDS.slice(0, 60)) {
      for (const item of buildSession(
        [...plain, ...must],
        none,
        options({ minutes: 30, playSecs: 120, seed }),
      ).items)
        if (item.track.must) counts.must++
        else counts.plain++
    }
    expect(counts.must / 10).toBeGreaterThan((1.5 * counts.plain) / 60)
  })
})
