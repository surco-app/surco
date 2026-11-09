import { camelotDistance } from '../../../shared/camelot'
import {
  type SessionOptions,
  type SessionPlan,
  TEMPO_LIMITS,
  tasteOf,
  transitionFits,
} from '../../../shared/sessionBuild'
import type { SessionTrack } from '../../../shared/sessionTypes'

const MAX_ALTERNATIVES = 5

export function alternativesFor(
  plan: SessionPlan,
  index: number,
  pool: readonly SessionTrack[],
  options: SessionOptions,
): SessionTrack[] {
  const item = plan.items[index]
  if (!item) return []
  const used = new Set(plan.items.map((other) => other.track.id))
  const before = plan.items[index - 1]?.track
  const after = plan.items[index + 1]?.track
  const open = pool.filter((track) => !used.has(track.id) && track.fresh === item.track.fresh)
  const fitting = (tempoLimit: number): SessionTrack[] =>
    open.filter(
      (track) =>
        (!before || transitionFits(before, track, options, tempoLimit)) &&
        (!after || transitionFits(track, after, options, tempoLimit)),
    )
  const tight = fitting(TEMPO_LIMITS.tight)
  const candidates = tight.length > 0 ? tight : fitting(TEMPO_LIMITS.wide)
  const maxPlays = pool.reduce((most, track) => Math.max(most, track.plays), 0)
  const apart = (track: SessionTrack): number =>
    (before ? (camelotDistance(before.key, track.key) ?? 1) : 0) +
    (after ? (camelotDistance(track.key, after.key) ?? 1) : 0)
  return [...candidates]
    .sort(
      (a, b) =>
        tasteOf(b, maxPlays, options.tasteWeight) - tasteOf(a, maxPlays, options.tasteWeight) ||
        apart(a) - apart(b) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, MAX_ALTERNATIVES)
}
