import { describe, expect, it } from 'vitest'
import type { SessionItem, SessionOptions, SessionPlan } from '../../../shared/sessionBuild'
import { summarizeSession } from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'
import { alternativesFor } from './sessionAlternatives'

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
  preferCombos: true,
  harmony: 'free',
  tasteWeight: true,
  alternate: false,
  freshShare: 0,
  surprise: false,
  seed: 1,
}

function planOf(...tracks: SessionTrack[]): SessionPlan {
  const items: SessionItem[] = tracks.map((t) => ({ track: t, why: { kind: 'chosen' } }))
  return { items, summary: summarizeSession(items, 900) }
}

const ids = (list: readonly SessionTrack[]): string[] => list.map((t) => t.id)

describe('alternativesFor', () => {
  it('never offers a track the session already has, the one in the place included', () => {
    const plan = planOf(track('a'), track('b'), track('c'))
    const pool = [track('a'), track('b'), track('c'), track('d')]
    expect(ids(alternativesFor(plan, 1, pool, options))).toEqual(['d'])
  })

  it('offers only tracks that fit the key of both neighbours when harmony is neighbours', () => {
    const plan = planOf(
      track('a', { key: '8A' }),
      track('b', { key: '8A' }),
      track('c', { key: '8B' }),
    )
    const pool = [
      ...plan.items.map((i) => i.track),
      track('fits', { key: '8A' }),
      track('clashes', { key: '3B' }),
      track('onlyFirst', { key: '9A' }),
    ]
    const found = alternativesFor(plan, 1, pool, { ...options, harmony: 'neighbours' })
    expect(ids(found)).toEqual(['fits'])
  })

  it('keeps tracks within four BPM of both neighbours and widens to eight only when none does', () => {
    const plan = planOf(
      track('a', { bpm: 140 }),
      track('b', { bpm: 140 }),
      track('c', { bpm: 140 }),
    )
    const close = track('close', { bpm: 143 })
    const far = track('far', { bpm: 147 })
    const tooFar = track('tooFar', { bpm: 152 })
    const base = [...plan.items.map((i) => i.track), tooFar]
    expect(ids(alternativesFor(plan, 1, [...base, close, far], options))).toEqual(['close'])
    expect(ids(alternativesFor(plan, 1, [...base, far], options))).toEqual(['far'])
  })

  it('puts the track you like most first', () => {
    const plan = planOf(track('a'), track('b'), track('c'))
    const pool = [
      ...plan.items.map((i) => i.track),
      track('plain'),
      track('liked', { rating: 100 }),
      track('played', { plays: 30 }),
    ]
    expect(ids(alternativesFor(plan, 1, pool, options))).toEqual(['liked', 'played', 'plain'])
  })

  it('offers at most five', () => {
    const plan = planOf(track('a'), track('b'), track('c'))
    const pool = [
      ...plan.items.map((i) => i.track),
      ...Array.from({ length: 9 }, (_, i) => track(`x${i}`)),
    ]
    expect(alternativesFor(plan, 1, pool, options)).toHaveLength(5)
  })

  it('fits the first and the last place against the one neighbour they have', () => {
    const plan = planOf(track('a', { key: '8A' }), track('b', { key: '8B' }))
    const pool = [
      ...plan.items.map((i) => i.track),
      track('nearA', { key: '8A' }),
      track('farA', { key: '3B' }),
    ]
    const found = alternativesFor(plan, 0, pool, { ...options, harmony: 'neighbours' })
    expect(ids(found)).toEqual(['nearA'])
  })

  it('offers new tracks for the place of a new track and known ones for any other', () => {
    const plan = planOf(track('a'), track('n', { fresh: true }), track('c'))
    const pool = [
      ...plan.items.map((i) => i.track),
      track('freshSpare', { fresh: true }),
      track('knownSpare'),
    ]
    expect(ids(alternativesFor(plan, 1, pool, options))).toEqual(['freshSpare'])
    expect(ids(alternativesFor(plan, 0, pool, options))).toEqual(['knownSpare'])
  })

  it('does not break the alternation between base and vocal', () => {
    const plan = planOf(
      track('a', { role: 'vocal' }),
      track('b', { role: 'base' }),
      track('c', { role: 'vocal' }),
    )
    const pool = [
      ...plan.items.map((i) => i.track),
      track('base2', { role: 'base' }),
      track('vocal2', { role: 'vocal' }),
      track('anyOne', { role: 'any' }),
    ]
    const found = alternativesFor(plan, 1, pool, { ...options, alternate: true })
    expect(ids(found).sort()).toEqual(['anyOne', 'base2'])
  })

  it('offers nothing for a place that does not exist', () => {
    const plan = planOf(track('a'))
    expect(alternativesFor(plan, 3, [track('b')], options)).toEqual([])
  })
})
