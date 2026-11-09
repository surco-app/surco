import { describe, expect, it } from 'vitest'
import { buildSession, type SessionOptions, swapAt } from './sessionBuild'
import type { SessionTrack } from './sessionTypes'

function track(id: string, secs: number): SessionTrack {
  return {
    id,
    role: 'any',
    key: null,
    bpm: 140,
    rating: 0,
    plays: 0,
    secs,
    fresh: false,
    title: id,
    artist: 'x',
  }
}

const options = (over: Partial<SessionOptions> = {}): SessionOptions => ({
  minutes: 60,
  playSecs: 180,
  preferCombos: false,
  harmony: 'free',
  tasteWeight: false,
  alternate: false,
  freshShare: 0,
  surprise: false,
  seed: 1,
  ...over,
})

const many = (count: number, secs: number): SessionTrack[] =>
  Array.from({ length: count }, (_, i) => track(`t${i}`, secs))

describe('session length when tracks are mixed and not played whole', () => {
  it('counts each long track only for the time it plays, so an hour takes twenty of them', () => {
    const plan = buildSession(many(60, 360), new Map(), options())
    expect(plan.items).toHaveLength(20)
    expect(plan.summary.secs).toBe(3600)
    expect(plan.summary.shortBySecs).toBe(0)
  })

  it('counts a track shorter than that in full', () => {
    const plan = buildSession(many(60, 120), new Map(), options())
    expect(plan.items).toHaveLength(30)
  })

  it('counts a track with no duration as the time it plays and still says it was assumed', () => {
    const plan = buildSession(many(60, 0), new Map(), options())
    expect(plan.items).toHaveLength(20)
    expect(plan.summary.missingDurations).toBe(20)
  })

  it('takes more tracks the less of each one is played', () => {
    const short = buildSession(many(80, 360), new Map(), options({ playSecs: 120 }))
    const long = buildSession(many(80, 360), new Map(), options({ playSecs: 240 }))
    expect(short.items).toHaveLength(30)
    expect(long.items).toHaveLength(15)
  })

  it('says how short the session fell using the time played, when the pool runs out', () => {
    const plan = buildSession(many(10, 360), new Map(), options())
    expect(plan.summary.secs).toBe(1800)
    expect(plan.summary.shortBySecs).toBe(1800)
  })

  it('keeps counting played time when a track is swapped', () => {
    const plan = buildSession(many(60, 360), new Map(), options())
    const swapped = swapAt(plan, 0, track('short', 90), 3600, 180)
    expect(swapped.summary.secs).toBe(3600 - 180 + 90)
    expect(swapped.summary.shortBySecs).toBe(90)
  })
})
