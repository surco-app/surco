import { camelotDistance } from './camelot'
import type { Combos } from './sessionCombos'
import type { SessionTrack, TrackRole } from './sessionTypes'

export interface SessionOptions {
  minutes: number
  preferCombos: boolean
  harmony: 'free' | 'neighbours' | 'same'
  tasteWeight: boolean
  alternate: boolean
  freshShare: number
  surprise: boolean
  seed: number
}

export type SessionWhy =
  | { kind: 'start' }
  | { kind: 'combo'; sets: number }
  | { kind: 'harmonic'; from: string; to: string; distance: number }
  | { kind: 'taste'; plays: number; rating: number }
  | { kind: 'bpm'; relaxed: boolean }
  | { kind: 'fresh'; key: string | null; role: TrackRole }

export interface SessionItem {
  track: SessionTrack
  why: SessionWhy
}

export interface SessionSummary {
  secs: number
  tracks: number
  combos: number
  fresh: number
  harmonic: number
  withKey: number
  shortBySecs: number
  missingDurations: number
}

export interface SessionPlan {
  items: SessionItem[]
  summary: SessionSummary
}

const UNKNOWN_SECS = 360
const TEMPO_TIGHT = 4
const TEMPO_WIDE = 8
const PLAYS_WEIGHT = 0.5

function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function secsOf(track: SessionTrack): number {
  return track.secs > 0 ? track.secs : UNKNOWN_SECS
}

function tempoGap(a: SessionTrack, b: SessionTrack): number | null {
  return a.bpm > 0 && b.bpm > 0 ? Math.abs(a.bpm - b.bpm) : null
}

function harmonyAllows(mode: SessionOptions['harmony'], distance: number | null): boolean {
  if (mode === 'free' || distance === null) return true
  return mode === 'neighbours' ? distance <= 1 : distance === 0
}

export function buildSession(
  pool: readonly SessionTrack[],
  combos: Combos,
  options: SessionOptions,
): SessionPlan {
  const random = seeded(options.seed)
  const eligible = pool.filter((track) => !track.fresh)
  const byId = new Map(eligible.map((track) => [track.id, track]))
  const maxPlays = eligible.reduce((most, track) => Math.max(most, track.plays), 0)
  const target = options.minutes * 60
  const used = new Set<string>()
  const items: SessionItem[] = []
  let total = 0

  const pickOne = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]

  const taste = (track: SessionTrack): number =>
    options.tasteWeight
      ? track.rating / 100 + (maxPlays > 0 ? PLAYS_WEIGHT * (track.plays / maxPlays) : 0)
      : 0

  const take = (track: SessionTrack, why: SessionWhy): void => {
    used.add(track.id)
    items.push({ track, why })
    total += secsOf(track)
  }

  const strongest = (): { from: SessionTrack; strength: number } | null => {
    let best = 0
    let found: SessionTrack[] = []
    for (const [fromId, targets] of combos) {
      const from = byId.get(fromId)
      if (!from) continue
      for (const [toId, strength] of targets) {
        if (!byId.has(toId)) continue
        if (strength > best) {
          best = strength
          found = [from]
        } else if (strength === best) found.push(from)
      }
    }
    return found.length > 0 ? { from: pickOne(found), strength: best } : null
  }

  const nextByCombo = (current: SessionTrack): SessionItem | null => {
    const targets = [...(combos.get(current.id) ?? [])].filter(
      ([id]) => byId.has(id) && !used.has(id),
    )
    if (targets.length === 0) return null
    const best = Math.max(...targets.map(([, strength]) => strength))
    const [id, sets] = pickOne(targets.filter(([, strength]) => strength === best))
    return { track: byId.get(id) as SessionTrack, why: { kind: 'combo', sets } }
  }

  const nextByFit = (current: SessionTrack): SessionItem | null => {
    const open = eligible.filter((track) => !used.has(track.id))
    const fitting = open.filter((track) =>
      harmonyAllows(options.harmony, camelotDistance(current.key, track.key)),
    )
    const tight = fitting.filter((track) => {
      const gap = tempoGap(current, track)
      return gap !== null && gap <= TEMPO_TIGHT
    })
    const relaxed = tight.length === 0
    const tier = relaxed
      ? fitting.filter((track) => {
          const gap = tempoGap(current, track)
          return gap === null || gap <= TEMPO_WIDE
        })
      : tight
    if (tier.length === 0) return null
    const best = Math.max(...tier.map(taste))
    const leaders = tier.filter((track) => taste(track) === best)
    const closest = Math.min(
      ...leaders.map((track) => camelotDistance(current.key, track.key) ?? 1),
    )
    const chosen = pickOne(
      leaders.filter((track) => (camelotDistance(current.key, track.key) ?? 1) === closest),
    )
    if (relaxed) return { track: chosen, why: { kind: 'bpm', relaxed: true } }
    const distance = camelotDistance(current.key, chosen.key)
    if (distance !== null && distance <= 1 && current.key !== null && chosen.key !== null)
      return {
        track: chosen,
        why: { kind: 'harmonic', from: current.key, to: chosen.key, distance },
      }
    if (best > 0)
      return { track: chosen, why: { kind: 'taste', plays: chosen.plays, rating: chosen.rating } }
    return { track: chosen, why: { kind: 'bpm', relaxed: false } }
  }

  if (eligible.length > 0) {
    const opening = options.preferCombos ? strongest() : null
    take(opening ? opening.from : pickOne(eligible), { kind: 'start' })
    while (total < target) {
      const current = items[items.length - 1].track
      const next = (options.preferCombos ? nextByCombo(current) : null) ?? nextByFit(current)
      if (!next) break
      take(next.track, next.why)
    }
  }

  let harmonic = 0
  let withKey = 0
  for (let i = 1; i < items.length; i++) {
    const distance = camelotDistance(items[i - 1].track.key, items[i].track.key)
    if (distance === null) continue
    withKey++
    if (distance <= 1) harmonic++
  }
  return {
    items,
    summary: {
      secs: total,
      tracks: items.length,
      combos: items.filter((item) => item.why.kind === 'combo').length,
      fresh: items.filter((item) => item.why.kind === 'fresh').length,
      harmonic,
      withKey,
      shortBySecs: Math.max(0, target - total),
      missingDurations: items.filter((item) => item.track.secs <= 0).length,
    },
  }
}
