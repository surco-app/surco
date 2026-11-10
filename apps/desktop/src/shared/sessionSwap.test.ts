import { describe, expect, it } from 'vitest'
import { buildSession, type SessionOptions, summarizeSession } from './sessionBuild'
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
    expect(summarizeSession(plan.items, options.minutes * 60, options.playSecs)).toEqual(
      plan.summary,
    )
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
