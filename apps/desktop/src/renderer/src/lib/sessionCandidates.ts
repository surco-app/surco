import { camelotOf } from '../../../shared/camelot'
import type { PlaylistRole, SessionTrack, TrackRole } from '../../../shared/sessionTypes'
import type { SourcePlaylistEntry } from '../../../shared/types'

export interface SessionSource {
  role: PlaylistRole | 'fresh'
  entries: readonly SourcePlaylistEntry[]
  freshRole?: TrackRole
}

interface Seen {
  entry: SourcePlaylistEntry
  roles: Set<TrackRole>
  origin: boolean
  freshRole: TrackRole
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

function roleOf(seen: Seen): TrackRole {
  const concrete = [...seen.roles].filter((role) => role !== 'any')
  return concrete.length === 1 ? concrete[0] : 'any'
}

export function toCandidates(sources: readonly SessionSource[]): SessionTrack[] {
  const found = new Map<string, Seen>()
  for (const source of sources) {
    for (const entry of source.entries) {
      const id = trackIdOf(entry)
      if (id === null) continue
      const seen = found.get(id) ?? {
        entry,
        roles: new Set<TrackRole>(),
        origin: false,
        freshRole: source.freshRole ?? 'any',
      }
      if (source.role !== 'fresh') {
        seen.origin = true
        seen.roles.add(source.role)
      }
      found.set(id, seen)
    }
  }
  return [...found].map(([id, seen]) => {
    const { entry } = seen
    return {
      id,
      role: seen.origin ? roleOf(seen) : seen.freshRole,
      key: camelotOf(entry.meta.key),
      bpm: tempoOf(entry.meta.bpm),
      rating: entry.meta.rating ?? 0,
      plays: entry.meta.playCount ?? 0,
      secs: entry.preview?.durationSec ?? 0,
      fresh: !seen.origin,
      title: entry.preview?.title ?? titleFromPath(entry.path),
      artist: entry.preview?.artist ?? '',
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
