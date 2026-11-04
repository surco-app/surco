import { type DjProgram, LIBRARY_PROGRAMS, programsInOrder } from '../../../shared/djProgram'
import type { PlaylistLibrary } from '../../../shared/types'
import type { TrackItem } from '../types'

export interface TrackProgram {
  flag: 'fromRekordbox' | 'fromTraktor' | 'fromEngine' | 'fromSerato'
  playlists: 'rekordboxPlaylists' | 'traktorPlaylists' | 'enginePlaylists' | 'seratoPlaylists'
  playlistsBase:
    | 'rekordboxPlaylistsBase'
    | 'traktorPlaylistsBase'
    | 'enginePlaylistsBase'
    | 'seratoPlaylistsBase'
  signatureTag: 'traktor' | 'engine' | null
  rereadAfterMove: boolean
}

export type TrackFlag = TrackProgram['flag']
export type PlaylistKey = TrackProgram['playlists'] | TrackProgram['playlistsBase']

export const TRACK_PROGRAMS: {
  [P in DjProgram]: P extends PlaylistLibrary ? TrackProgram : Pick<TrackProgram, 'flag'>
} = {
  rekordbox: {
    flag: 'fromRekordbox',
    playlists: 'rekordboxPlaylists',
    playlistsBase: 'rekordboxPlaylistsBase',
    signatureTag: null,
    rereadAfterMove: true,
  },
  traktor: {
    flag: 'fromTraktor',
    playlists: 'traktorPlaylists',
    playlistsBase: 'traktorPlaylistsBase',
    signatureTag: 'traktor',
    rereadAfterMove: false,
  },
  engine: {
    flag: 'fromEngine',
    playlists: 'enginePlaylists',
    playlistsBase: 'enginePlaylistsBase',
    signatureTag: 'engine',
    rereadAfterMove: false,
  },
  serato: {
    flag: 'fromSerato',
    playlists: 'seratoPlaylists',
    playlistsBase: 'seratoPlaylistsBase',
    signatureTag: null,
    rereadAfterMove: false,
  },
}

type LibraryFields = Partial<Pick<TrackItem, TrackFlag | PlaylistKey>>

const FLAG_ORDER = programsInOrder(['rekordbox', 'engine', 'traktor', 'serato'])

export function copyFlags(from: LibraryFields, to: LibraryFields): void {
  for (const program of FLAG_ORDER) {
    const { flag } = TRACK_PROGRAMS[program]
    if (from[flag]) to[flag] = true
  }
}

export function copyPlaylists(from: LibraryFields, to: LibraryFields): void {
  for (const program of LIBRARY_PROGRAMS) {
    const { playlists, playlistsBase } = TRACK_PROGRAMS[program]
    if (from[playlists]) to[playlists] = from[playlists]
    if (from[playlistsBase]) to[playlistsBase] = from[playlistsBase]
  }
}

export function jobPlaylists(track: LibraryFields): Pick<LibraryFields, PlaylistKey> {
  const job: LibraryFields = {}
  for (const program of LIBRARY_PROGRAMS) {
    const { playlists, playlistsBase } = TRACK_PROGRAMS[program]
    job[playlists] = track[playlists]
    job[playlistsBase] = track[playlistsBase]
  }
  return job
}
