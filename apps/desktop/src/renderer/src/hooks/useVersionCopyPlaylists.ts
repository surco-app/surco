import { useQueries } from '@tanstack/react-query'
import { useEffect } from 'react'
import { LIBRARY_PROGRAMS } from '../../../shared/djProgram'
import type { PlaylistLibrary } from '../../../shared/types'
import {
  type Membership,
  type PlaylistsEdit,
  playlistOptions,
  playlistsEdit,
  playlistsOfPath,
  rekordboxPathOf,
} from '../lib/rekordboxPlaylists'
import { SOURCE_PROGRAMS, SOURCE_READ } from '../lib/sourcePrograms'
import type { TrackItem } from '../types'
import { useProgramsAvailable } from './useProgramsAvailable'
import { useStableCallback } from './useStableCallback'

interface Params {
  item: TrackItem
  // Per program, its copy that is another version of the track, for the programs whose
  // playlists field is shown: staging into a field the DJ never sees would apply it unseen.
  copies: Partial<Record<PlaylistLibrary, string>>
  onChange: (patch: Partial<TrackItem>) => void
  onRecordUndo?: (ids: string[]) => void
}

// The DJ filed another version of this track in a program's playlists, and the new file
// belongs there too. The copy is another track, so the field cannot act on it the way it does
// on a copy of the same recording: its playlists are staged on the track instead, ticked in
// the field and applied by the convert. Once per track and program, never over a pick already
// staged, so an undo or an emptied field stays the DJ's choice.
export function useVersionCopyPlaylists({ item, copies, onChange, onRecordUndo }: Params): void {
  const available = useProgramsAvailable()
  const due = item.metaCleared
    ? []
    : LIBRARY_PROGRAMS.filter(
        (program) =>
          available[program] &&
          !!copies[program] &&
          !item.copyPlaylistsFilled?.includes(program) &&
          item.playlists?.[program]?.targets === undefined,
      )
  // The same keys the playlists field reads, so the tree is read once for both.
  const trees = useQueries({
    queries: due.map((program) => ({
      queryKey: ['source-tree', program],
      queryFn: SOURCE_READ[program].tree,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  // The track's own path rides along: the staged edit keeps what it holds as its base.
  const memberships = useQueries({
    queries: due.map((program) => {
      const key = [...new Set([copies[program] as string, rekordboxPathOf(item)])].sort()
      return {
        queryKey: [SOURCE_PROGRAMS[program].membershipKey, key],
        queryFn: () => SOURCE_READ[program].membership(key),
        staleTime: Number.POSITIVE_INFINITY,
      }
    }),
  })
  const ready = due.filter((_, i) => trees[i].data && memberships[i].data)
  const apply = useStableCallback(() => {
    const edits: PlaylistsEdit['playlists'][] = []
    for (const program of ready) {
      const i = due.indexOf(program)
      const membership = memberships[i].data as Membership
      const options = playlistOptions(trees[i].data ?? [])
      const picks = playlistsOfPath(copies[program] as string, membership, options)
      if (picks.length > 0) edits.push(playlistsEdit(item, membership, picks, program).playlists)
    }
    const filled = { copyPlaylistsFilled: [...(item.copyPlaylistsFilled ?? []), ...ready] }
    if (edits.length === 0) {
      onChange(filled)
      return
    }
    onRecordUndo?.([item.id])
    onChange({ playlists: Object.assign({}, ...edits), ...filled })
  })
  const readyKey = ready.join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the track and the programs ready; apply reads the live row and reads.
  useEffect(() => {
    if (readyKey) apply()
  }, [item.id, readyKey])
}
