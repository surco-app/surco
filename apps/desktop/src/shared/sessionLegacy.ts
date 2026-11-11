import type { DjProgram } from './djProgram'
import { isFrom, type TrackOrigin } from './trackOrigin'
import type { RekordboxPlaylistTarget, SessionEdit } from './types'

type LegacyProgram = 'rekordbox' | 'traktor' | 'engine' | 'serato'

export interface LegacyOrigin {
  fromRekordbox?: boolean
  fromEngine?: boolean
  fromTraktor?: boolean
  fromSerato?: boolean
  rekordboxPlaylists?: RekordboxPlaylistTarget[]
  rekordboxPlaylistsBase?: string[]
  traktorPlaylists?: RekordboxPlaylistTarget[]
  traktorPlaylistsBase?: string[]
  enginePlaylists?: RekordboxPlaylistTarget[]
  enginePlaylistsBase?: string[]
  seratoPlaylists?: RekordboxPlaylistTarget[]
  seratoPlaylistsBase?: string[]
}

const LEGACY_KEYS: Record<
  LegacyProgram,
  {
    flag: keyof LegacyOrigin & `from${string}`
    targets: keyof LegacyOrigin & `${string}Playlists`
    base: keyof LegacyOrigin & `${string}PlaylistsBase`
  }
> = {
  rekordbox: {
    flag: 'fromRekordbox',
    targets: 'rekordboxPlaylists',
    base: 'rekordboxPlaylistsBase',
  },
  engine: { flag: 'fromEngine', targets: 'enginePlaylists', base: 'enginePlaylistsBase' },
  traktor: { flag: 'fromTraktor', targets: 'traktorPlaylists', base: 'traktorPlaylistsBase' },
  serato: { flag: 'fromSerato', targets: 'seratoPlaylists', base: 'seratoPlaylistsBase' },
}

const LEGACY_PROGRAMS = Object.keys(LEGACY_KEYS) as LegacyProgram[]

const LEGACY_PLAYLIST_ORDER: readonly LegacyProgram[] = ['rekordbox', 'traktor', 'engine', 'serato']

export function fromLegacy(edit: SessionEdit & LegacyOrigin): SessionEdit {
  const rest: SessionEdit & LegacyOrigin = { ...edit }
  const programs: DjProgram[] = []
  const playlists: NonNullable<TrackOrigin['playlists']> = {}
  for (const program of LEGACY_PROGRAMS) {
    const { flag, targets, base } = LEGACY_KEYS[program]
    if (rest[flag]) programs.push(program)
    if (rest[targets] || rest[base])
      playlists[program] = {
        ...(rest[targets] && { targets: rest[targets] }),
        ...(rest[base] && { base: rest[base] }),
      }
    delete rest[flag]
    delete rest[targets]
    delete rest[base]
  }
  return {
    ...rest,
    ...(rest.programs === undefined && programs.length > 0 && { programs }),
    ...(rest.playlists === undefined && Object.keys(playlists).length > 0 && { playlists }),
  }
}

export function withLegacy(edit: SessionEdit): SessionEdit & LegacyOrigin {
  const legacy: LegacyOrigin = {}
  for (const program of LEGACY_PROGRAMS)
    if (isFrom(edit, program)) legacy[LEGACY_KEYS[program].flag] = true
  for (const program of LEGACY_PLAYLIST_ORDER) {
    const { targets, base } = LEGACY_KEYS[program]
    const staged = edit.playlists?.[program]
    if (staged?.targets) legacy[targets] = staged.targets
    if (staged?.base) legacy[base] = staged.base
  }
  return { ...edit, ...legacy }
}
