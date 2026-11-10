import { camelotOf } from '../../../shared/camelot'
import type { PlaylistRole, SessionTrack, TrackRole } from '../../../shared/sessionTypes'
import type { SourcePlaylistEntry } from '../../../shared/types'
import type { SessionPhase } from './sessionTree'
import { baseTitle, splitArtists } from './tracklistMatch'

export interface SessionSource {
  role: PlaylistRole
  entries: readonly SourcePlaylistEntry[]
}

interface Seen {
  entry: SourcePlaylistEntry
  roles: Set<TrackRole>
}

export function trackIdOf(entry: SourcePlaylistEntry): string | null {
  if (entry.separator) return null
  if (entry.contentId) return entry.contentId
  return entry.path ? entry.path.normalize('NFC') : null
}

function tempoOf(text: string | undefined): number {
  const bpm = Number(text)
  return Number.isFinite(bpm) && bpm > 0 ? bpm : 0
}

function titleFromPath(path: string | null): string {
  const name = (path ?? '').split(/[\\/]/).pop() ?? ''
  return name.replace(/\.[^.]+$/, '')
}

const NEW_DAYS = 30
const DAY_MS = 86_400_000

function recencyOf(entry: SourcePlaylistEntry, now: Date): 'recent' | 'old' | 'unknown' {
  const added = Date.parse(entry.meta.dateAdded ?? '')
  if (Number.isNaN(added)) return 'unknown'
  return now.getTime() - added <= NEW_DAYS * DAY_MS ? 'recent' : 'old'
}

function hasHistory(entry: SourcePlaylistEntry): boolean {
  return (entry.meta.playCount ?? 0) > 0 || (entry.meta.rating ?? 0) > 0
}

function roleOf(seen: Seen, fromLibrary?: ReadonlySet<'base' | 'vocal'>): TrackRole {
  const concrete = [...seen.roles].filter((role) => role !== 'any')
  if (concrete.length === 1) return concrete[0]
  if (concrete.length === 0 && fromLibrary?.size === 1) return [...fromLibrary][0]
  return 'any'
}

export function toCandidates(
  sources: readonly SessionSource[],
  now: Date = new Date(),
  library: ReadonlyMap<string, ReadonlySet<'base' | 'vocal'>> = new Map(),
  phases: ReadonlyMap<string, ReadonlySet<SessionPhase>> = new Map(),
): SessionTrack[] {
  const found = new Map<string, Seen>()
  for (const source of sources) {
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id === null) continue
      const seen = found.get(id) ?? { entry, roles: new Set<TrackRole>() }
      seen.roles.add(source.role)
      found.set(id, seen)
    }
  }
  const origins = [...found.values()]
  const anyHistory = origins.some((seen) => hasHistory(seen.entry))
  const isNew = (seen: Seen): boolean => {
    const recency = recencyOf(seen.entry, now)
    if (recency !== 'unknown') return recency === 'recent'
    return anyHistory && !hasHistory(seen.entry)
  }
  const everyNew = origins.length > 0 && origins.every(isNew)
  return [...found].map(([id, seen]) => {
    const { entry } = seen
    const title = entry.preview?.title ?? titleFromPath(entry.path)
    const acts = splitArtists(entry.preview?.artist ?? '')
    const named = baseTitle(title)
    const marks = phases.get(id) ?? new Set<SessionPhase>()
    const part =
      marks.has('open') === marks.has('close') ? null : marks.has('open') ? 'open' : 'close'
    return {
      id,
      role: roleOf(seen, library.get(id)),
      key: camelotOf(entry.meta.key),
      bpm: tempoOf(entry.meta.bpm),
      rating: entry.meta.rating ?? 0,
      plays: entry.meta.playCount ?? 0,
      secs: entry.preview?.durationSec ?? 0,
      fresh: !everyNew && isNew(seen),
      title,
      artist: entry.preview?.artist ?? '',
      ...(named && { song: `${acts[0] ?? ''}|${named}` }),
      acts,
      ...(part && { phase: part }),
      ...(marks.has('must') && { must: true }),
    }
  })
}

export function mixedSequences(sources: readonly SessionSource[]): string[][] {
  const sequences: string[][] = []
  for (const source of sources) {
    if (source.role !== 'any') continue
    let run: string[] = []
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id === null) {
        if (run.length > 0) sequences.push(run)
        run = []
      } else run.push(id)
    }
    if (run.length > 0) sequences.push(run)
  }
  return sequences
}
