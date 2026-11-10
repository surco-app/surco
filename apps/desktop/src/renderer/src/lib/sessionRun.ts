import { buildSession, type SessionOptions, type SessionPlan } from '../../../shared/sessionBuild'
import { type Combos, mineCombos } from '../../../shared/sessionCombos'
import type { PlaylistRole, SessionAnswers, SessionTrack } from '../../../shared/sessionTypes'
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
}): SessionRun {
  const { answers, roles, rows, seed, library = {}, pins, startPath } = input
  const sources: SessionSource[] = answers.sources.map((id) => ({
    role: roles[id] ?? 'any',
    entries: rows.get(id) ?? [],
  }))
  const evidence = new Map<string, Set<'base' | 'vocal'>>()
  for (const [playlistId, role] of Object.entries(library)) {
    for (const entry of rows.get(playlistId) ?? []) {
      const id = trackIdOf(entry)
      if (id === null) continue
      const held = evidence.get(id) ?? new Set<'base' | 'vocal'>()
      held.add(role)
      evidence.set(id, held)
    }
  }
  const pool = toCandidates(sources, new Date(), evidence)
  const sequences = mixedSequences(sources)
  const ids = new Set(pool.map((track) => track.id))
  const pairs = mineCombos(sequences, ids, 1)
  const combos = mineCombos(sequences, ids, MIN_PLAYLISTS_PER_COMBO)
  const startEntry = startPath
    ? sources
        .flatMap((source) => source.entries)
        .find((entry) => entry.path?.normalize('NFC') === startPath.normalize('NFC'))
    : undefined
  const startWith = startEntry ? (trackIdOf(startEntry) ?? undefined) : undefined
  const plan = buildSession(pool, pairs, sessionOptionsOf(answers, seed, pins, startWith))
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
