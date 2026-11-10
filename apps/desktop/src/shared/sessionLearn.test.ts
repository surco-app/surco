import { describe, expect, it } from 'vitest'
import { learnMixing } from './sessionLearn'
import type { SessionTrack } from './sessionTypes'

function track(id: string, bpm: number, key: string | null = null): SessionTrack {
  return {
    id,
    role: 'any',
    key,
    bpm,
    rating: 0,
    plays: 0,
    secs: 300,
    fresh: false,
    title: id,
    artist: id,
  }
}

function setOf(bpms: number[], keys: (string | null)[] = []) {
  const tracks = bpms.map((bpm, i) => track(`t${i}`, bpm, keys[i] ?? null))
  return { pool: new Map(tracks.map((t) => [t.id, t])), sequence: tracks.map((t) => t.id) }
}

describe('learnMixing reads how the DJ moves between tracks in their own sets', () => {
  it('takes the usual tempo jump as the median and the wide one as the 80th percentile', () => {
    const jumps = Array.from({ length: 41 }, (_, i) => (i % 10) + 1)
    let bpm = 120
    const bpms = [bpm, ...jumps.map((jump, i) => (bpm += i % 2 === 0 ? jump : -jump))]
    const { pool, sequence } = setOf(bpms)
    const learned = learnMixing([sequence], pool)
    expect(learned.tempoTight).toBe(5)
    expect(learned.tempoWide).toBe(8)
  })

  it('keeps the stock tempo window when the sets show too few transitions to tell', () => {
    const { pool, sequence } = setOf([120, 121, 125, 122])
    expect(learnMixing([sequence], pool).tempoTight).toBeUndefined()
    expect(learnMixing([sequence], pool).tempoWide).toBeUndefined()
  })

  it('cares about the key as much as the sets beat chance', () => {
    const ring = ['8A', '9A', '10A', '11A', '12A', '1A', '2A', '3A', '4A', '5A', '6A', '7A']
    const harmonic = setOf(
      Array.from({ length: 60 }, () => 128),
      Array.from({ length: 60 }, (_, i) => ring[i % 12]),
    )
    const scattered = setOf(
      Array.from({ length: 60 }, () => 128),
      Array.from({ length: 60 }, (_, i) => ring[(i * 5) % 12]),
    )
    expect(learnMixing([harmonic.sequence], harmonic.pool).keyCare).toBeGreaterThan(0.9)
    expect(learnMixing([scattered.sequence], scattered.pool).keyCare).toBe(0)
  })

  it('leaves the key care unknown when the sets carry too few keys', () => {
    const { pool, sequence } = setOf(Array.from({ length: 60 }, () => 128))
    expect(learnMixing([sequence], pool).keyCare).toBeUndefined()
  })
})
