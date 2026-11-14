import { buildSession, type SessionOptions, type SessionPlan } from '../../../shared/sessionBuild'
import { type Combos, mineCombos, withMatching } from '../../../shared/sessionCombos'
import { type LearnedMixing, learnMixing } from '../../../shared/sessionLearn'
import type { PlaylistRole, SessionAnswers, SessionTrack } from '../../../shared/sessionTypes'
import type { PlaylistTrackRef, SourcePlaylistEntry } from '../../../shared/types'
import { mixedSequences, type SessionSource, toCandidates, trackIdOf } from './sessionCandidates'
import type { SessionPhase } from './sessionTree'

const MIN_PLAYLISTS_PER_COMBO = 2

export interface SessionRun {
  plan: SessionPlan
  refs: PlaylistTrackRef[]
  refsById: ReadonlyMap<string, PlaylistTrackRef>
  pool: SessionTrack[]
  combos: Combos
  learned: LearnedMixing
}

export function sessionOptionsOf(
  answers: SessionAnswers,
  seed: number,
  startWith?: string,
): SessionOptions {
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
    ...(startWith && { startWith }),
  }
}

export function sessionPool(input: {
  sources: readonly SessionSource[]
  chosen: readonly string[]
  rows: ReadonlyMap<string, readonly SourcePlaylistEntry[]>
  library?: Readonly<Record<string, 'base' | 'vocal'>>
  phases?: Readonly<Record<string, SessionPhase>>
}): SessionTrack[] {
  const { sources, rows, library = {}, phases = {} } = input
  const chosen = new Set(input.chosen)
  const evidence = new Map<string, Set<'base' | 'vocal'>>()
  for (const [playlistId, role] of Object.entries(library)) {
    if (!chosen.has(playlistId)) continue
    for (const entry of rows.get(playlistId) ?? []) {
      const id = trackIdOf(entry)
      if (id === null) continue
      const held = evidence.get(id) ?? new Set<'base' | 'vocal'>()
      held.add(role)
      evidence.set(id, held)
    }
  }
  const marks = new Map<string, Set<SessionPhase>>()
  for (const [playlistId, phase] of Object.entries(phases)) {
    if (!chosen.has(playlistId)) continue
    for (const entry of rows.get(playlistId) ?? []) {
      const id = trackIdOf(entry)
      if (id === null) continue
      const held = marks.get(id) ?? new Set<SessionPhase>()
      held.add(phase)
      marks.set(id, held)
    }
  }
  return toCandidates(sources, new Date(), evidence, marks)
}

export function runSession(input: {
  answers: SessionAnswers
  roles: Readonly<Record<string, PlaylistRole>>
  rows: ReadonlyMap<string, readonly SourcePlaylistEntry[]>
  seed: number
  library?: Readonly<Record<string, 'base' | 'vocal'>>
  startPath?: string
  made?: ReadonlySet<string>
  phases?: Readonly<Record<string, SessionPhase>>
  matching?: readonly (readonly [string, string])[]
}): SessionRun {
  const {
    answers,
    roles,
    rows,
    seed,
    library = {},
    startPath,
    made = new Set(),
    phases = {},
    matching = [],
  } = input
  const sources: SessionSource[] = answers.sources.map((id) => ({
    role: roles[id] ?? 'any',
    entries: rows.get(id) ?? [],
  }))
  const pool = sessionPool({ sources, chosen: answers.sources, rows, library, phases })
  const sequences = mixedSequences(sources.filter((_, i) => !made.has(answers.sources[i])))
  const ids = new Set(pool.map((track) => track.id))
  const idOfPath = new Map<string, string>()
  for (const source of sources)
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id !== null && entry.path && !entry.separator)
        idOfPath.set(entry.path.normalize('NFC'), id)
    }
  const matchedIds = matching.flatMap(([a, b]) => {
    const [x, y] = [idOfPath.get(a.normalize('NFC')), idOfPath.get(b.normalize('NFC'))]
    return x && y ? [[x, y] as const] : []
  })
  const pairs = withMatching(mineCombos(sequences, ids, 1), matchedIds, ids)
  const combos = mineCombos(sequences, ids, MIN_PLAYLISTS_PER_COMBO)
  const startEntry = startPath
    ? sources
        .flatMap((source) => source.entries)
        .find((entry) => entry.path?.normalize('NFC') === startPath.normalize('NFC'))
    : undefined
  const startWith = startEntry ? (trackIdOf(startEntry) ?? undefined) : undefined
  const learned = learnMixing(sequences, new Map(pool.map((track) => [track.id, track])))
  const plan = buildSession(pool, pairs, {
    ...sessionOptionsOf(answers, seed, startWith),
    ...learned,
  })
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
  return { plan, refs, refsById, pool, combos, learned }
}
