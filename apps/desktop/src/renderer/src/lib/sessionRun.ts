import { buildSession, type SessionPlan } from '../../../shared/sessionBuild'
import { type Combos, mineCombos } from '../../../shared/sessionCombos'
import type {
  PlaylistRole,
  SessionAnswers,
  SessionTrack,
  TrackRole,
} from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, SourcePlaylistEntry } from '../../../shared/types'
import { type SessionSource, setSequences, toCandidates, trackIdOf } from './sessionCandidates'

export interface SessionRun {
  plan: SessionPlan
  refs: PlaylistTrackRef[]
  pool: SessionTrack[]
  combos: Combos
}

function freshRoleOf(role: PlaylistRole | undefined): TrackRole {
  return role === 'base' || role === 'vocal' ? role : 'any'
}

export function runSession(input: {
  answers: SessionAnswers
  roles: Readonly<Record<string, PlaylistRole>>
  rows: ReadonlyMap<string, readonly SourcePlaylistEntry[]>
  seed: number
}): SessionRun {
  const { answers, roles, rows, seed } = input
  const sources: SessionSource[] = [
    ...answers.sources.map((id) => ({ role: roles[id] ?? 'any', entries: rows.get(id) ?? [] })),
    ...answers.fresh.map((id) => ({
      role: 'fresh' as const,
      entries: rows.get(id) ?? [],
      freshRole: freshRoleOf(roles[id]),
    })),
  ]
  const pool = toCandidates(sources)
  const combos = mineCombos(setSequences(sources), new Set(pool.map((track) => track.id)))
  const plan = buildSession(pool, combos, {
    minutes: answers.minutes,
    preferCombos: answers.preferCombos,
    harmony: answers.harmony,
    tasteWeight: answers.tasteWeight,
    alternate: answers.alternate,
    freshShare: answers.freshShare,
    surprise: answers.surprise,
    seed,
  })
  const entryOf = new Map<string, SourcePlaylistEntry>()
  for (const source of sources) {
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id !== null && !entryOf.has(id)) entryOf.set(id, entry)
    }
  }
  const refs = plan.items.map((item): PlaylistTrackRef => {
    const entry = entryOf.get(item.track.id)
    return { contentId: entry?.contentId, paths: entry?.path ? [entry.path] : [] }
  })
  return { plan, refs, pool, combos }
}
