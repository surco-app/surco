import { useQueries } from '@tanstack/react-query'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourcePlaylistEntry } from '../../../shared/types'
import { pickedLibraries, revealableIn } from '../lib/revealCue'
import type { TrackItem } from '../types'
import { readPlaylist } from './useSourceBrowser'

export function useLibraryReveals(
  track: TrackItem,
  available: readonly PlaylistSource[],
): PlaylistSource[] {
  const wanted =
    track.status === 'done' ? pickedLibraries(track).filter((s) => available.includes(s)) : []
  const reads = useQueries({
    queries: wanted.map((source) => ({
      queryKey: ['source-playlist', source, RECENTLY_ADDED_ID],
      queryFn: () => readPlaylist(source, RECENTLY_ADDED_ID),
      staleTime: Number.POSITIVE_INFINITY,
    })),
  })
  const recent: Partial<Record<PlaylistSource, SourcePlaylistEntry[]>> = {}
  wanted.forEach((source, i) => {
    const entries = reads[i]?.data
    if (entries) recent[source] = entries
  })
  return revealableIn(track, recent)
}
