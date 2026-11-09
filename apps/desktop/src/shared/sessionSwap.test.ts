import { describe, expect, it } from 'vitest'
import { buildSession, type SessionOptions, summarizeSession, swapAt } from './sessionBuild'
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

const options: SessionOptions = {
  minutes: 15,
  playSecs: 3600,
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  freshShare: 0,
  surprise: false,
  seed: 1,
}

const pool = [
  track('a', { key: '8A' }),
  track('b', { key: '8B' }),
  track('c', { key: '9A' }),
  track('d', { key: '3B' }),
]
const combos = new Map([['a', new Map([['b', 2]])]])

describe('summarizeSession', () => {
  it('gives the same summary the builder gave for the plan it built', () => {
    const plan = buildSession(pool, combos, options)
    expect(summarizeSession(plan.items, options.minutes * 60, options.playSecs)).toEqual(plan.summary)
  })

  it('counts a plan with no items as empty and short of the whole time', () => {
    expect(summarizeSession([], 900, 3600)).toEqual({
      secs: 0,
      tracks: 0,
      combos: 0,
      fresh: 0,
      harmonic: 0,
      withKey: 0,
      shortBySecs: 900,
      missingDurations: 0,
      audioSecs: 0,
    })
  })
})

describe('swapAt', () => {
  it('puts the chosen track in that place only and marks it as chosen by hand', () => {
    const plan = buildSession(pool, combos, options)
    const spare = pool.find((t) => !plan.items.some((i) => i.track.id === t.id)) ?? track('z')
    const swapped = swapAt(plan, 1, spare, options.minutes * 60, options.playSecs)
    expect(swapped.items[1].track.id).toBe(spare.id)
    expect(swapped.items[1].why).toEqual({ kind: 'chosen' })
    expect(swapped.items[0]).toBe(plan.items[0])
    expect(swapped.items.length).toBe(plan.items.length)
  })

  it('recomputes the summary: a combo that was replaced stops counting and the length follows the new track', () => {
    const plan = buildSession(pool, combos, options)
    expect(plan.summary.combos).toBeGreaterThan(0)
    const comboAt = plan.items.findIndex((i) => i.why.kind === 'combo')
    const longer = track('long', { secs: 600 })
    const swapped = swapAt(plan, comboAt, longer, options.minutes * 60, options.playSecs)
    expect(swapped.summary.combos).toBe(plan.summary.combos - 1)
    expect(swapped.summary.secs).toBe(plan.summary.secs - plan.items[comboAt].track.secs + 600)
  })

  it('leaves the plan it was given untouched', () => {
    const plan = buildSession(pool, combos, options)
    const before = JSON.stringify(plan)
    swapAt(plan, 1, track('z'), options.minutes * 60, options.playSecs)
    expect(JSON.stringify(plan)).toBe(before)
  })

  it('returns the plan as it was for a place that does not exist', () => {
    const plan = buildSession(pool, combos, options)
    expect(swapAt(plan, 99, track('z'), 900, 3600)).toBe(plan)
    expect(swapAt(plan, -1, track('z'), 900, 3600)).toBe(plan)
  })
})
