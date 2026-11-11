import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { LIBRARY_PROGRAMS, type LibraryProgram } from '../../../shared/djProgram'
import type { PlaylistLibrary, Settings, SourceNode } from '../../../shared/types'
import type { PlaylistsSpec } from '../lib/fieldSpecs'
import { PLAYLIST_FIELDS, withPlaylistField } from '../lib/fields'
import {
  bulkPlaylistState,
  effectivePlaylists,
  type Membership,
  type PlaylistOption,
  type PlaylistsEdit,
  playlistOptions,
  playlistsEdit,
  rekordboxPathOf,
  withTarget,
} from '../lib/rekordboxPlaylists'
import { SOURCE_PROGRAMS, SOURCE_READ } from '../lib/sourcePrograms'
import type { TrackItem } from '../types'
import { useProgramsAvailable } from './useProgramsAvailable'

const OFFERED = {
  rekordbox: 'rekordboxPlaylistsFieldOffered',
  traktor: 'traktorPlaylistsFieldOffered',
  engine: 'enginePlaylistsFieldOffered',
  serato: 'seratoPlaylistsFieldOffered',
} as const satisfies Record<LibraryProgram, keyof Settings>

export function useLibraryAvailable(library: PlaylistLibrary): boolean {
  return useProgramsAvailable()[library] ?? false
}

export function useRekordboxPlaylistTree(
  enabled: boolean,
  library: PlaylistLibrary = 'rekordbox',
): SourceNode[] | undefined {
  const { data } = useQuery({
    queryKey: ['source-tree', library],
    queryFn: SOURCE_READ[library].tree,
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data
}

export function useRekordboxPlaylistOptions(
  enabled: boolean,
  library: PlaylistLibrary = 'rekordbox',
): PlaylistOption[] | undefined {
  const data = useRekordboxPlaylistTree(enabled, library)
  return useMemo(() => (data ? playlistOptions(data) : undefined), [data])
}

export function useRekordboxMembership(
  paths: string[],
  enabled: boolean,
  library: PlaylistLibrary = 'rekordbox',
): Membership | undefined {
  const key = [...new Set(paths)].sort()
  const { data } = useQuery({
    queryKey: [SOURCE_PROGRAMS[library].membershipKey, key],
    queryFn: () => SOURCE_READ[library].membership(key),
    enabled: enabled && key.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data
}

export function useOfferPlaylistFields(
  settings: Settings | null,
  available: Record<PlaylistLibrary, boolean>,
  save: (patch: Partial<Settings>) => void,
): void {
  const tried = useRef(new Set<PlaylistLibrary>())
  useEffect(() => {
    if (!settings) return
    let visibleFields = settings.visibleFields
    const patch: Partial<Settings> = {}
    for (const library of LIBRARY_PROGRAMS) {
      if (tried.current.has(library)) continue
      const next = withPlaylistField(
        visibleFields,
        PLAYLIST_FIELDS[library],
        settings[OFFERED[library]] === true,
        available[library],
      )
      if (!next) continue
      tried.current.add(library)
      visibleFields = next
      patch[OFFERED[library]] = true
    }
    if (Object.keys(patch).length > 0) save({ visibleFields, ...patch })
  }, [settings, available, save])
}

export function usePlaylistsSpec(
  library: PlaylistLibrary,
  opts: {
    shown: boolean
    item: TrackItem
    tracks: TrackItem[]
    onChange: (patch: Partial<TrackItem>) => void
    onChangeTracks?: (patches: ({ id: string } & PlaylistsEdit)[]) => void
  },
): PlaylistsSpec | undefined {
  const { item, tracks, onChange, onChangeTracks } = opts
  const shown = useLibraryAvailable(library) && opts.shown
  const tree = useRekordboxPlaylistTree(shown, library)
  const options = useRekordboxPlaylistOptions(shown, library)
  const membership = useRekordboxMembership(tracks.map(rekordboxPathOf), shown, library)
  const gated = SOURCE_PROGRAMS[library].edit?.gate === 'traktorCollection'
  const { data: canSave } = useQuery({
    queryKey: ['traktor-can-save', 'field'],
    queryFn: () => window.api.traktorCanSave(),
    enabled: shown && gated,
  })
  return useMemo(() => {
    if (!shown || !tree || !options || !membership) return undefined
    return {
      library,
      disabled: gated && canSave === false ? 'unconfirmed' : undefined,
      tree,
      options,
      single: {
        value: effectivePlaylists(item, membership, options, library) ?? [],
        onChange: (next) => onChange(playlistsEdit(item, membership, next, library)),
      },
      bulk: {
        states: bulkPlaylistState(tracks, membership, options, library) ?? [],
        onToggle: (target, on) => {
          const patches = withTarget(tracks, membership, options, target, on, library)
          if (patches) onChangeTracks?.(patches)
        },
      },
    }
  }, [
    library,
    gated,
    shown,
    tree,
    options,
    membership,
    canSave,
    item,
    tracks,
    onChange,
    onChangeTracks,
  ])
}
