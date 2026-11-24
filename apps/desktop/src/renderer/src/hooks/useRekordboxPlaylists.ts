import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LIBRARY_PROGRAMS, type LibraryProgram } from '../../../shared/djProgram'
import type {
  PlaylistLibrary,
  RekordboxPlaylistTarget,
  Settings,
  SourceNode,
} from '../../../shared/types'
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
  playlistsOfPath,
  rekordboxPathOf,
  withTarget,
} from '../lib/rekordboxPlaylists'
import { useAppSettings } from '../lib/settingsContext'
import { SOURCE_PROGRAMS, SOURCE_READ } from '../lib/sourcePrograms'
import { useToast } from '../lib/toastContext'
import type { TrackItem } from '../types'
import { queuedKey, useCopyPlaylistEdits } from './useCopyPlaylistEdits'
import { useProgramsAvailable } from './useProgramsAvailable'

const OFFERED = {
  rekordbox: 'rekordboxPlaylistsFieldOffered',
  traktor: 'traktorPlaylistsFieldOffered',
  engine: 'enginePlaylistsFieldOffered',
  serato: 'seratoPlaylistsFieldOffered',
  virtualdj: 'virtualdjPlaylistsFieldOffered',
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
  const key = useMemo(() => [...new Set(paths)].sort(), [paths])
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

// A track whose program already holds a copy of it acts on that copy: a tick files the copy
// in the program at once instead of waiting for a conversion. A track with playlists already
// staged for the program keeps staging, so nothing staged is hidden and applied unseen when
// it converts.
export function usePlaylistsSpec(
  library: PlaylistLibrary,
  opts: {
    shown: boolean
    item: TrackItem
    tracks: TrackItem[]
    onChange: (patch: Partial<TrackItem>) => void
    onChangeTracks?: (patches: ({ id: string } & PlaylistsEdit)[]) => void
    copyPathOf?: (track: TrackItem) => string | undefined
  },
): PlaylistsSpec | undefined {
  const { item, tracks, onChange, onChangeTracks, copyPathOf } = opts
  const shown = useLibraryAvailable(library) && opts.shown
  const tree = useRekordboxPlaylistTree(shown, library)
  const options = useRekordboxPlaylistOptions(shown, library)
  const paths = useMemo(
    () =>
      shown
        ? tracks.map((t) => (copyPathOf && copyOf(t, library, copyPathOf)) || rekordboxPathOf(t))
        : [],
    [shown, tracks, copyPathOf, library],
  )
  const membership = useRekordboxMembership(paths, shown, library)
  const { toggle, queued, canRemove } = useCopyPlaylistEdits(library, membership)
  const { t: tr } = useTranslation()
  const { reportError } = useToast()
  const gated = SOURCE_PROGRAMS[library].edit?.gate === 'traktorCollection'
  const { traktorNmlPath } = useAppSettings()
  const { data: canSave } = useQuery({
    queryKey: ['traktor-can-save', traktorNmlPath],
    queryFn: () => window.api.traktorCanSave(),
    enabled: shown && gated,
  })
  const copy = copyPathOf && copyOf(item, library, copyPathOf)
  return useMemo(() => {
    if (!shown || !tree || !options || !membership) return undefined
    const disabled = gated && canSave === false ? 'unconfirmed' : undefined
    const single: PlaylistsSpec['single'] = copy
      ? copySingle(copy, membership, options, queued, (target, on) => {
          if (disabled) return
          toggle([copy], target, on).catch((error) => {
            window.api.logError(String(error))
            reportError(
              tr(
                `${SOURCE_PROGRAMS[library].edit?.messagePrefix ?? 'sources.edit.'}refused.unreadable`,
              ),
            )
          })
        })
      : {
          value: effectivePlaylists(item, membership, options, library) ?? [],
          onChange: (next) => onChange(playlistsEdit(item, membership, next, library)),
        }
    return {
      library,
      disabled,
      locked: copy && !canRemove ? single.value.flatMap((t) => (t.id ? [t.id] : [])) : undefined,
      tree,
      options,
      single,
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
    copy,
    queued,
    toggle,
    canRemove,
    reportError,
    tr,
  ])
}

function copyOf(
  track: TrackItem,
  library: PlaylistLibrary,
  copyPathOf: (track: TrackItem) => string | undefined,
): string | undefined {
  return track.playlists?.[library]?.targets === undefined ? copyPathOf(track) : undefined
}

// An edit queued while the program is open is not in the membership read from disk yet, so
// the field shows it as the DJ left it until the read agrees.
function copySingle(
  copy: string,
  membership: Membership,
  options: readonly PlaylistOption[],
  queued: ReadonlyMap<string, boolean>,
  toggle: (target: RekordboxPlaylistTarget, on: boolean) => void,
): PlaylistsSpec['single'] {
  const read = playlistsOfPath(copy, membership, options)
  const inRead = new Set(read.map((t) => t.id))
  const value = [
    ...read.filter((t) => t.id === undefined || queued.get(queuedKey(copy, t.id)) !== false),
    ...options
      .filter((o) => !inRead.has(o.id) && queued.get(queuedKey(copy, o.id)) === true)
      .map((o) => ({ id: o.id, name: o.name })),
  ]
  return {
    value,
    onChange: (next) => {
      const was = new Set(value.map((t) => t.id))
      const now = new Set(next.map((t) => t.id))
      for (const t of next) if (t.id === undefined || !was.has(t.id)) toggle(t, true)
      for (const t of value) if (!now.has(t.id)) toggle(t, false)
    },
  }
}
