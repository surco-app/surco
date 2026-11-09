import { buildSession, type SessionOptions, type SessionPlan } from '../../../shared/sessionBuild'
import { type Combos, mineCombos } from '../../../shared/sessionCombos'
import type {
  PlaylistRole,
  SessionAnswers,
  SessionTrack,
  TrackRole,
} from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, SourcePlaylistEntry } from '../../../shared/types'
import { mixedSequences, type SessionSource, toCandidates, trackIdOf } from './sessionCandidates'

const MIN_PLAYLISTS_PER_COMBO = 2

export interface SessionRun {
  plan: SessionPlan
  refs: PlaylistTrackRef[]
  refsById: ReadonlyMap<string, PlaylistTrackRef>
  pool: SessionTrack[]
  combos: Combos
}

function freshRoleOf(role: PlaylistRole | undefined): TrackRole {
  return role === 'base' || role === 'vocal' ? role : 'any'
}

export function sessionOptionsOf(answers: SessionAnswers, seed: number): SessionOptions {
  return {
    minutes: answers.minutes,
    playSecs: answers.playMinutes * 60,
    preferCombos: answers.preferCombos,
    harmony: answers.harmony,
    tasteWeight: answers.tasteWeight,
    alternate: answers.alternate,
    freshShare: answers.freshShare,
    surprise: answers.surprise,
    seed,
  }
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
  const combos = mineCombos(
    mixedSequences(sources),
    new Set(pool.map((track) => track.id)),
    MIN_PLAYLISTS_PER_COMBO,
  )
  const plan = buildSession(pool, combos, sessionOptionsOf(answers, seed))
  const refsById = new Map<string, PlaylistTrackRef>()
  for (const source of sources) {
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id !== null && !refsById.has(id)) {
        refsById.set(id, { contentId: entry.contentId, paths: entry.path ? [entry.path] : [] })
      }
    }
  }
  const refs = plan.items.map((item) => refsById.get(item.track.id) ?? { paths: [] })
  return { plan, refs, refsById, pool, combos }
}
