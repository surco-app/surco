import { describe, expect, it } from 'vitest'
import type { DamageFinding, DamageOutcome } from '../../../shared/types'
import { damageKey, defaultStaged, repairsOf, settleDamage, summarizeDamage } from './damageReview'

const genre = (path: string, over: Partial<DamageFinding> = {}): DamageFinding => ({
  id: `genre-number\0${path}`,
  kind: 'genre-number',
  path,
  certainty: 'sure',
  evidence: [],
  before: { key: 'damage.value.text', params: { value: '(35) Deep House' } },
  options: ['House; Deep House', 'House/Deep House'],
  repair: { target: 'genre', path, from: '(35) Deep House', to: 'House; Deep House' },
  ...over,
})

const engine: DamageFinding = {
  id: 'engine-cues\0/m/e.wav',
  kind: 'engine-cues',
  path: '/m/e.wav',
  certainty: 'sure',
  evidence: [],
  before: { key: 'damage.value.seconds', params: { sec: 1 } },
  options: [],
  repair: {
    target: 'engine',
    path: '/m/e.wav',
    fileBytes: 1,
    expectTrackData: { sampleRate: 48000, sampleCount: 1 },
    trimmedMs: 0,
  },
}

// Sure findings come staged like a safe spelling; a likely one waits for the user, and a
// warning or a repair still queued has nothing to stage.
describe('defaultStaged', () => {
  it('stages sure repairs only', () => {
    const staged = defaultStaged([
      genre('/m/a.mp3'),
      genre('/m/b.mp3', { certainty: 'likely' }),
      genre('/m/c.mp3', { repair: null }),
      genre('/m/d.mp3', { pending: true }),
    ])
    expect([...staged]).toEqual([damageKey(genre('/m/a.mp3'))])
  })
})

describe('repairsOf', () => {
  it('takes the genre the user picked and leaves out what is not staged', () => {
    const a = genre('/m/a.mp3')
    const b = genre('/m/b.mp3')
    const items = repairsOf([a, b, engine], new Set([damageKey(a), damageKey(engine)]), (key) =>
      key === damageKey(a) ? 'House/Deep House' : null,
    )
    expect(items).toEqual([
      { id: a.id, repair: { ...a.repair, to: 'House/Deep House' } },
      { id: engine.id, repair: engine.repair },
    ])
  })

  it('never hands a pending or warning-only finding', () => {
    const p = genre('/m/p.mp3', { pending: true })
    const w = genre('/m/w.mp3', { repair: null })
    expect(repairsOf([p, w], new Set([damageKey(p), damageKey(w)]), () => null)).toEqual([])
  })
})

describe('summarizeDamage', () => {
  it('counts the staged repairs per kind', () => {
    const items = repairsOf(
      [genre('/m/a.mp3'), genre('/m/b.mp3'), engine],
      new Set([damageKey(genre('/m/a.mp3')), damageKey(genre('/m/b.mp3')), damageKey(engine)]),
      () => null,
    )
    expect(summarizeDamage(items)).toEqual({ 'genre-number': 2, 'engine-cues': 1 })
  })
})

// The re-check scans again: a repair reported as done whose damage is still there did not
// do what it said.
describe('settleDamage', () => {
  it('turns a repaired finding still found into a mismatch', () => {
    const outcomes: DamageOutcome[] = [
      { id: genre('/m/a.mp3').id, state: 'repaired', backupId: 'b1' },
      { id: engine.id, state: 'repaired' },
      { id: genre('/m/c.mp3').id, state: 'pending' },
    ]
    expect(settleDamage(outcomes, [genre('/m/a.mp3'), genre('/m/c.mp3')])).toEqual([
      { id: genre('/m/a.mp3').id, state: 'mismatch', backupId: 'b1' },
      { id: engine.id, state: 'repaired' },
      { id: genre('/m/c.mp3').id, state: 'pending' },
    ])
  })
})
