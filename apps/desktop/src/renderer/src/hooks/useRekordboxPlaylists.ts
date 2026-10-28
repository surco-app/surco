import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
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
import type { TrackItem } from '../types'

const READ = {
  rekordbox: {
    available: () => window.api.rekordboxAvailable(),
    tree: () => window.api.loadRekordboxTree(),
    membership: (paths: string[]) => window.api.rekordboxMembership(paths),
  },
  traktor: {
    available: () => window.api.traktorAvailable(),
    tree: () => window.api.loadTraktorTree(),
    membership: (paths: string[]) => window.api.traktorMembership(paths),
  },
  engine: {
    available: () => window.api.engineAvailable(),
    tree: () => window.api.loadEngineTree(),
    membership: (paths: string[]) => window.api.engineMembership(paths),
  },
}

const OFFERED = {
  rekordbox: 'rekordboxPlaylistsFieldOffered',
  traktor: 'traktorPlaylistsFieldOffered',
  engine: 'enginePlaylistsFieldOffered',
} as const

export function useLibraryAvailable(library: PlaylistLibrary): boolean {
  const { data = false } = useQuery({
    queryKey: ['source-available', library],
    queryFn: READ[library].available,
    staleTime: Number.POSITIVE_INFINITY,
  })
  return data
}

export function useRekordboxAvailable(): boolean {
  return useLibraryAvailable('rekordbox')
}

export function useRekordboxPlaylistTree(
  enabled: boolean,
  library: PlaylistLibrary = 'rekordbox',
): SourceNode[] | undefined {
  const { data } = useQuery({
    queryKey: ['source-tree', library],
    queryFn: READ[library].tree,
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
    queryKey: [`${library}-membership`, key],
    queryFn: () => READ[library].membership(key),
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
    for (const library of ['rekordbox', 'traktor', 'engine'] as const) {
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
  const { data: canSave } = useQuery({
    queryKey: ['traktor-can-save', 'field'],
    queryFn: () => window.api.traktorCanSave(),
    enabled: shown && library === 'traktor',
  })
  return useMemo(() => {
    if (!shown || !tree || !options || !membership) return undefined
    return {
      library,
      disabled: library === 'traktor' && canSave === false ? 'unconfirmed' : undefined,
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
  }, [library, shown, tree, options, membership, canSave, item, tracks, onChange, onChangeTracks])
}
