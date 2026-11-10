import { camelotDistance } from './camelot'
import type { Combos } from './sessionCombos'
import type { SessionTrack, TrackRole } from './sessionTypes'

export interface SessionOptions {
  minutes: number
  playSecs: number
  preferCombos: boolean
  harmony: 'free' | 'neighbours' | 'same'
  tasteWeight: boolean
  alternate: boolean
  freshShare: number
  surprise: boolean
  seed: number
  pinned?: readonly { index: number; trackId: string }[]
  fixedLength?: number
  startWith?: string
  tempoTight?: number
  tempoWide?: number
  keyCare?: number
}

export type SessionWhy =
  | { kind: 'start' }
  | { kind: 'combo'; sets: number }
  | { kind: 'partner' }
  | { kind: 'harmonic'; from: string; to: string; distance: number }
  | { kind: 'taste'; plays: number; rating: number }
  | { kind: 'bpm'; relaxed: boolean }
  | { kind: 'fresh'; key: string | null; role: TrackRole }
  | { kind: 'chosen' }
  | { kind: 'phase'; phase: 'open' | 'close' }

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
  audioSecs: number
}

export interface SessionPlan {
  items: SessionItem[]
  summary: SessionSummary
}

const UNKNOWN_SECS = 360
const TEMPO_TIGHT = 4
const TEMPO_WIDE = 8
const PLAYS_WEIGHT = 0.5
const SURPRISE_EVERY = 4
const TASTE_POWER = 3
const KEY_WEIGHTS = { same: 1, neighbour: 0.85, far: 0.35, unknown: 0.3 } as const
const ARC_FROM = 0.25
const ARC_TO = 0.75
const ARC_SOFTNESS = 3
const ARC_UNKNOWN = 0.5
const SAME_ACT_WEIGHT = 0.3
const TASTE_TOP_SHARE = 0.25
const OPEN_UNTIL = 0.25
const CLOSE_FROM = 0.8
const PHASE_BOOST = 4
const PHASE_OFF = 0.15
const MUST_BOOST = 2.5

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

function secsOf(track: SessionTrack, playSecs: number): number {
  return Math.min(track.secs > 0 ? track.secs : UNKNOWN_SECS, playSecs)
}

function tempoGap(a: SessionTrack, b: SessionTrack): number | null {
  return a.bpm > 0 && b.bpm > 0 ? Math.abs(a.bpm - b.bpm) : null
}

function harmonyAllows(mode: SessionOptions['harmony'], distance: number | null): boolean {
  if (mode === 'free' || distance === null) return true
  return mode === 'neighbours' ? distance <= 1 : distance === 0
}

function richest(tracks: readonly SessionTrack[]): SessionTrack[] {
  const data = (track: SessionTrack): number => (track.bpm > 0 ? 1 : 0) + (track.key ? 1 : 0)
  const most = Math.max(...tracks.map(data))
  return tracks.filter((track) => data(track) === most)
}

function stockKeyWeight(distance: number | null): number {
  if (distance === null) return KEY_WEIGHTS.unknown
  if (distance === 0) return KEY_WEIGHTS.same
  return distance === 1 ? KEY_WEIGHTS.neighbour : KEY_WEIGHTS.far
}

export function tasteOf(track: SessionTrack, maxPlays: number, enabled: boolean): number {
  if (!enabled) return 0
  return track.rating / 100 + (maxPlays > 0 ? PLAYS_WEIGHT * (track.plays / maxPlays) : 0)
}

export function transitionFits(
  from: SessionTrack,
  to: SessionTrack,
  options: Pick<SessionOptions, 'harmony' | 'alternate'>,
  tempoLimit: number,
): boolean {
  if (!harmonyAllows(options.harmony, camelotDistance(from.key, to.key))) return false
  const gap = tempoGap(from, to)
  if (gap !== null && gap > tempoLimit) return false
  return !options.alternate || from.role === 'any' || to.role === 'any' || from.role !== to.role
}

export const TEMPO_LIMITS = { tight: TEMPO_TIGHT, wide: TEMPO_WIDE } as const

function freshSlots(goal: number, estimated: number): number[] {
  return Array.from({ length: goal }, (_, k) =>
    Math.max(1, Math.round(((k + 1) * estimated) / (goal + 1))),
  )
}

export function buildSession(
  pool: readonly SessionTrack[],
  combos: Combos,
  options: SessionOptions,
): SessionPlan {
  const random = seeded(options.seed)
  const tempoTight = options.tempoTight ?? TEMPO_TIGHT
  const tempoWide = options.tempoWide ?? TEMPO_WIDE
  const keyCare = options.keyCare ?? 1
  const eligible = pool.filter((track) => !track.fresh)
  const newcomers = pool.filter((track) => track.fresh)
  const byId = new Map(eligible.map((track) => [track.id, track]))
  const maxPlays = eligible.reduce((most, track) => Math.max(most, track.plays), 0)
  const target = options.minutes * 60
  const poolById = new Map(pool.map((track) => [track.id, track]))
  const pins = new Map<number, SessionTrack>()
  for (const pin of options.pinned ?? []) {
    const pinned = poolById.get(pin.trackId)
    if (pinned && pin.index >= 0 && pin.index < (options.fixedLength ?? 0))
      pins.set(pin.index, pinned)
  }
  const fixed = pins.size > 0 ? (options.fixedLength ?? 0) : 0
  const used = new Set<string>([...pins.values()].map((track) => track.id))
  const songs = new Set<string>([...pins.values()].flatMap((track) => track.song ?? []))
  const isOpen = (track: SessionTrack): boolean =>
    !used.has(track.id) && !(track.song !== undefined && songs.has(track.song))
  let avoid: TrackRole | null = null
  const items: SessionItem[] = []
  let total = 0
  let expected: TrackRole | null = null
  let placedFresh = 0

  const averageSecs =
    eligible.length > 0
      ? eligible.reduce((sum, track) => sum + secsOf(track, options.playSecs), 0) / eligible.length
      : UNKNOWN_SECS
  const estimated = Math.max(1, Math.ceil(target / averageSecs))
  const slots = freshSlots(
    Math.min(newcomers.length, Math.round(options.freshShare * estimated)),
    estimated,
  )

  const pickOne = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]

  const pickWeighted = <T>(list: readonly T[], weight: (item: T) => number): T => {
    const weights = list.map(weight)
    let roll = random() * weights.reduce((sum, w) => sum + w, 0)
    for (let i = 0; i < list.length; i++) {
      roll -= weights[i]
      if (roll < 0) return list[i]
    }
    return list[list.length - 1]
  }

  const taste = (track: SessionTrack): number => tasteOf(track, maxPlays, options.tasteWeight)

  const keyWeight = (from: SessionTrack, to: SessionTrack): number =>
    1 - keyCare * (1 - stockKeyWeight(camelotDistance(from.key, to.key)))

  const liking = (track: SessionTrack): number => (1 + taste(track)) ** TASTE_POWER

  const progress = (): number => Math.min(1, total / target)

  const inPhase = (track: SessionTrack): boolean => {
    if (track.phase === 'open') return progress() < OPEN_UNTIL
    return track.phase === 'close' && progress() >= CLOSE_FROM
  }

  const phaseDue = (track: SessionTrack): SessionWhy | null => {
    return track.phase !== undefined && inPhase(track) ? { kind: 'phase', phase: track.phase } : null
  }

  const phaseWeight = (track: SessionTrack): number => {
    const must = track.must ? MUST_BOOST : 1
    if (track.phase === undefined) return must
    return must * (inPhase(track) ? PHASE_BOOST : PHASE_OFF)
  }

  const actWeight = (from: SessionTrack, to: SessionTrack): number =>
    (to.acts ?? []).some((act) => from.acts?.includes(act)) ? SAME_ACT_WEIGHT : 1

  const tempos = eligible
    .map((track) => track.bpm)
    .filter((bpm) => bpm > 0)
    .sort((a, b) => a - b)
  const tempoAt = (share: number): number => tempos[Math.round(share * (tempos.length - 1))]

  const arcWeight = (track: SessionTrack): number => {
    if (tempos.length === 0) return 1
    if (track.bpm <= 0) return ARC_UNKNOWN
    const from = tempoAt(ARC_FROM)
    const wanted = from + (tempoAt(ARC_TO) - from) * Math.min(1, total / target)
    return 1 / (1 + Math.abs(track.bpm - wanted) / ARC_SOFTNESS)
  }

  const knownRoles = new Set(eligible.filter((track) => track.role !== 'any').map((t) => t.role))
  const strict = options.alternate && knownRoles.has('base') && knownRoles.has('vocal')

  const roleFits = (track: SessionTrack): boolean => {
    if (!options.alternate) return true
    if (track.role === 'any') return !strict
    if (avoid !== null && track.role === avoid) return false
    return expected === null || track.role === expected
  }

  const roleOrNeutral = (track: SessionTrack): boolean =>
    !options.alternate ||
    track.role === 'any' ||
    ((avoid === null || track.role !== avoid) && (expected === null || track.role === expected))

  const take = (track: SessionTrack, why: SessionWhy): void => {
    used.add(track.id)
    if (track.song !== undefined) songs.add(track.song)
    items.push({ track, why })
    total += secsOf(track, options.playSecs)
    if (track.role === 'base') expected = 'vocal'
    else if (track.role === 'vocal') expected = 'base'
    else if (strict && expected !== null) expected = expected === 'base' ? 'vocal' : 'base'
  }

  const comboOpening = (allowed: ReadonlySet<string>): SessionTrack | null => {
    const starts: { from: SessionTrack; strength: number }[] = []
    for (const [fromId, targets] of combos) {
      const from = byId.get(fromId)
      if (!from || !allowed.has(fromId)) continue
      const strength = Math.max(0, ...[...targets].filter(([id]) => byId.has(id)).map(([, n]) => n))
      if (strength > 0) starts.push({ from, strength })
    }
    if (starts.length === 0) return null
    return pickWeighted(
      starts,
      (start) =>
        start.strength ** 2 * liking(start.from) * arcWeight(start.from) * phaseWeight(start.from),
    ).from
  }

  const partnerFits = (from: SessionTrack, to: SessionTrack): boolean => {
    const gap = tempoGap(from, to)
    return (
      harmonyAllows(options.harmony, camelotDistance(from.key, to.key)) &&
      (gap === null || gap <= tempoWide)
    )
  }

  const nextByCombo = (current: SessionTrack): SessionItem | null => {
    const targets = [...(combos.get(current.id) ?? [])].filter(([id, strength]) => {
      const track = byId.get(id)
      if (track === undefined || !isOpen(track)) return false
      if (strength >= 2) return roleFits(track) || (strict && track.role === 'any')
      return roleFits(track) && partnerFits(current, track)
    })
    if (targets.length === 0) return null
    const best = Math.max(...targets.map(([, strength]) => strength))
    const [id, sets] = pickOne(targets.filter(([, strength]) => strength === best))
    const track = byId.get(id) as SessionTrack
    return { track, why: sets >= 2 ? { kind: 'combo', sets } : { kind: 'partner' } }
  }

  const fitTier = (
    current: SessionTrack,
    list: readonly SessionTrack[],
    fits: (track: SessionTrack) => boolean = roleFits,
    allowFar = false,
    harmony: SessionOptions['harmony'] = options.harmony,
  ): { tier: SessionTrack[]; relaxed: boolean } => {
    const fitting = list.filter(
      (track) => fits(track) && harmonyAllows(harmony, camelotDistance(current.key, track.key)),
    )
    const tight = fitting.filter((track) => {
      const gap = tempoGap(current, track)
      return gap !== null && gap <= tempoTight
    })
    if (tight.length > 0) return { tier: tight, relaxed: false }
    const wide = fitting.filter((track) => {
      const gap = tempoGap(current, track)
      return gap !== null && gap <= tempoWide
    })
    if (wide.length > 0) return { tier: wide, relaxed: true }
    const unknown = fitting.filter((track) => tempoGap(current, track) === null)
    if (unknown.length > 0 || !allowFar || fitting.length === 0)
      return { tier: unknown, relaxed: true }
    const nearest = Math.min(
      ...fitting.map((track) => tempoGap(current, track) ?? Number.POSITIVE_INFINITY),
    )
    return {
      tier: fitting.filter((track) => tempoGap(current, track) === nearest),
      relaxed: true,
    }
  }

  const nextByFit = (
    current: SessionTrack,
    onlyWithoutCombo: boolean,
    harmony: SessionOptions['harmony'] = options.harmony,
  ): SessionItem | null => {
    const open = eligible.filter(
      (track) => isOpen(track) && !(onlyWithoutCombo && combos.get(current.id)?.has(track.id)),
    )
    let fit = fitTier(current, open, roleFits, true, harmony)
    if (fit.tier.length === 0 && options.alternate)
      fit = fitTier(current, open, roleFits, true, 'free')
    if (fit.tier.length === 0) fit = fitTier(current, open, roleOrNeutral, true, harmony)
    if (fit.tier.length === 0) fit = fitTier(current, open, () => true, true, harmony)
    const { tier, relaxed } = fit
    if (tier.length === 0) return null
    const chosen = pickWeighted(
      tier,
      (track) =>
        liking(track) *
        keyWeight(current, track) *
        arcWeight(track) *
        actWeight(current, track) *
        phaseWeight(track),
    )
    if (relaxed) return { track: chosen, why: { kind: 'bpm', relaxed: true } }
    const due = phaseDue(chosen)
    if (due) return { track: chosen, why: due }
    const distance = camelotDistance(current.key, chosen.key)
    if (distance !== null && distance <= 1 && current.key !== null && chosen.key !== null)
      return {
        track: chosen,
        why: { kind: 'harmonic', from: current.key, to: chosen.key, distance },
      }
    const likedMore = tier.filter((track) => taste(track) > taste(chosen)).length
    if (taste(chosen) > 0 && likedMore <= TASTE_TOP_SHARE * tier.length)
      return { track: chosen, why: { kind: 'taste', plays: chosen.plays, rating: chosen.rating } }
    return { track: chosen, why: { kind: 'bpm', relaxed: false } }
  }

  const nextFresh = (current: SessionTrack): SessionItem | null => {
    const open = newcomers.filter(isOpen)
    const { tier } = fitTier(current, open)
    if (tier.length === 0) return null
    const chosen = pickWeighted(
      tier,
      (track) =>
        keyWeight(current, track) *
        arcWeight(track) *
        actWeight(current, track) *
        phaseWeight(track),
    )
    if (total + secsOf(chosen, options.playSecs) >= target) return null
    return { track: chosen, why: { kind: 'fresh', key: chosen.key, role: chosen.role } }
  }

  const pickNext = (current: SessionTrack): SessionItem | null => {
    const surpriseTurn = options.surprise && items.length % SURPRISE_EVERY === 0
    const slotOpen =
      placedFresh < slots.length && items.length >= slots[placedFresh] && !current.fresh
    return (
      (surpriseTurn ? nextByFit(current, true) : null) ??
      (options.preferCombos ? nextByCombo(current) : null) ??
      (slotOpen ? nextFresh(current) : null) ??
      nextByFit(current, false)
    )
  }

  const opening = (): SessionTrack | null => {
    const open = (strict ? eligible.filter((track) => track.role !== 'any') : eligible).filter(
      isOpen,
    )
    const sung = open.filter((track) => track.role === 'vocal')
    const starters = sung.length > 0 ? sung : open
    const start = options.preferCombos
      ? comboOpening(new Set(starters.map((track) => track.id)))
      : null
    if (start) return start
    return starters.length > 0
      ? pickWeighted(richest(starters), (track) => arcWeight(track) * phaseWeight(track))
      : null
  }

  const openingWhy = (track: SessionTrack): SessionWhy =>
    track.phase === 'open' ? { kind: 'phase', phase: 'open' } : { kind: 'start' }

  if (fixed > 0) {
    for (let i = 0; i < fixed; i++) {
      const pin = pins.get(i)
      if (pin) {
        take(pin, { kind: 'chosen' })
        continue
      }
      const after = pins.get(i + 1)
      avoid = options.alternate && after && after.role !== 'any' ? after.role : null
      const current = items[items.length - 1]?.track
      if (!current) {
        const first = opening()
        if (first) take(first, openingWhy(first))
      } else {
        const next = pickNext(current) ?? nextByFit(current, false, 'free')
        if (next) {
          if (next.why.kind === 'fresh') placedFresh++
          take(next.track, next.why)
        }
      }
      avoid = null
    }
  } else if (eligible.length > 0) {
    const asked = options.startWith ? poolById.get(options.startWith) : undefined
    const first = asked ?? opening()
    if (first) take(first, asked ? { kind: 'chosen' } : openingWhy(first))
    while (items.length > 0 && total < target) {
      const next = pickNext(items[items.length - 1].track)
      if (!next) break
      if (next.why.kind === 'fresh') placedFresh++
      take(next.track, next.why)
    }
  }

  return { items, summary: summarizeSession(items, target, options.playSecs) }
}

export function summarizeSession(
  items: readonly SessionItem[],
  targetSecs: number,
  playSecs: number,
): SessionSummary {
  let harmonic = 0
  let withKey = 0
  for (let i = 1; i < items.length; i++) {
    const distance = camelotDistance(items[i - 1].track.key, items[i].track.key)
    if (distance === null) continue
    withKey++
    if (distance <= 1) harmonic++
  }
  const secs = items.reduce((sum, item) => sum + secsOf(item.track, playSecs), 0)
  return {
    secs,
    tracks: items.length,
    combos: items.filter((item) => item.why.kind === 'combo').length,
    fresh: items.filter((item) => item.track.fresh).length,
    harmonic,
    withKey,
    shortBySecs: Math.max(0, targetSecs - secs),
    missingDurations: items.filter((item) => item.track.secs <= 0).length,
    audioSecs: items.reduce((sum, item) => sum + Math.max(0, item.track.secs), 0),
  }
}

export function swapAt(
  plan: SessionPlan,
  index: number,
  track: SessionTrack,
  targetSecs: number,
  playSecs: number,
): SessionPlan {
  if (index < 0 || index >= plan.items.length) return plan
  const items = plan.items.map((item, i) =>
    i === index ? { track, why: { kind: 'chosen' } as const } : item,
  )
  return { items, summary: summarizeSession(items, targetSecs, playSecs) }
}
