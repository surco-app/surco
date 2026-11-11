import { LIBRARY_PROGRAMS } from '../../../shared/djProgram'
import { type TrackOrigin, withPrograms } from '../../../shared/trackOrigin'
import type { PlaylistLibrary } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface TrackProgram {
  signatureTag: 'traktor' | 'engine' | null
  rereadAfterMove: boolean
}

export const TRACK_PROGRAMS: Record<PlaylistLibrary, TrackProgram> = {
  rekordbox: {
    signatureTag: null,
    rereadAfterMove: true,
  },
  traktor: {
    signatureTag: 'traktor',
    rereadAfterMove: false,
  },
  engine: {
    signatureTag: 'engine',
    rereadAfterMove: false,
  },
  serato: {
    signatureTag: null,
    rereadAfterMove: false,
  },
  virtualdj: {
    signatureTag: null,
    rereadAfterMove: false,
  },
}

export function mergedOrigin(onto: TrackOrigin, from: TrackOrigin): TrackOrigin {
  const merged: TrackOrigin = {}
  const programs = withPrograms(onto, from.programs ?? [])
  if (programs.length > 0) merged.programs = programs
  const playlists: NonNullable<TrackOrigin['playlists']> = {}
  for (const program of LIBRARY_PROGRAMS) {
    const targets = from.playlists?.[program]?.targets ?? onto.playlists?.[program]?.targets
    const base = from.playlists?.[program]?.base ?? onto.playlists?.[program]?.base
    if (targets || base) playlists[program] = { ...(targets && { targets }), ...(base && { base }) }
  }
  if (Object.keys(playlists).length > 0) merged.playlists = playlists
  return merged
}

export function patchedTrack(t: TrackItem, patch: Partial<TrackItem>): TrackItem {
  if (!patch.playlists) return { ...t, ...patch }
  return { ...t, ...patch, playlists: { ...t.playlists, ...patch.playlists } }
}

export function jobPlaylists(track: TrackOrigin): Pick<TrackOrigin, 'playlists'> {
  return { playlists: track.playlists }
}
