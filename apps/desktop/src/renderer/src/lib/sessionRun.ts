import { buildSession, type SessionOptions, type SessionPlan } from '../../../shared/sessionBuild'
import { type Combos, mineCombos } from '../../../shared/sessionCombos'
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

export interface SessionPins {
  pinned: readonly { index: number; trackId: string }[]
  length: number
}

export function sessionOptionsOf(
  answers: SessionAnswers,
  seed: number,
  pins?: SessionPins,
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
    ...(pins && { pinned: pins.pinned, fixedLength: pins.length }),
    ...(startWith && { startWith }),
  }
}

export function runSession(input: {
  answers: SessionAnswers
  roles: Readonly<Record<string, PlaylistRole>>
  rows: ReadonlyMap<string, readonly SourcePlaylistEntry[]>
  seed: number
  library?: Readonly<Record<string, 'base' | 'vocal'>>
  pins?: SessionPins
  startPath?: string
  made?: ReadonlySet<string>
  phases?: Readonly<Record<string, SessionPhase>>
}): SessionRun {
  const {
    answers,
    roles,
    rows,
    seed,
    library = {},
    pins,
    startPath,
    made = new Set(),
    phases = {},
  } = input
  const sources: SessionSource[] = answers.sources.map((id) => ({
    role: roles[id] ?? 'any',
    entries: rows.get(id) ?? [],
  }))
  const chosen = new Set(answers.sources)
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
  const pool = toCandidates(sources, new Date(), evidence, marks)
  const sequences = mixedSequences(sources.filter((_, i) => !made.has(answers.sources[i])))
  const ids = new Set(pool.map((track) => track.id))
  const pairs = mineCombos(sequences, ids, 1)
  const combos = mineCombos(sequences, ids, MIN_PLAYLISTS_PER_COMBO)
  const startEntry = startPath
    ? sources
        .flatMap((source) => source.entries)
        .find((entry) => entry.path?.normalize('NFC') === startPath.normalize('NFC'))
    : undefined
  const startWith = startEntry ? (trackIdOf(startEntry) ?? undefined) : undefined
  const learned = learnMixing(sequences, new Map(pool.map((track) => [track.id, track])))
  const plan = buildSession(pool, pairs, {
    ...sessionOptionsOf(answers, seed, pins, startWith),
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
