import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource, SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'
import { playlistMembership } from './playlistView'

export type RevealStep =
  | { do: 'source' }
  | { do: 'playlist' }
  | { do: 'wait' }
  | { do: 'select'; id: string }
  | { do: 'give-up' }

export function revealStep(
  contentId: string,
  view: {
    source: PlaylistSource | null
    playlistId: string | null
    loading: boolean
    listed: readonly (string | undefined)[] | undefined
    contentOf: ReadonlyMap<string, string> | undefined
  },
): RevealStep {
  if (view.source !== 'rekordbox') return { do: 'source' }
  if (view.playlistId !== RECENTLY_ADDED_ID) return { do: 'playlist' }
  if (view.loading || !view.listed || !view.contentOf) return { do: 'wait' }
  for (const [id, of] of view.contentOf) if (of === contentId) return { do: 'select', id }
  return view.listed.includes(contentId) ? { do: 'wait' } : { do: 'give-up' }
}

export function revealTrackStep(
  source: PlaylistSource,
  trackId: string,
  view: {
    source: PlaylistSource | null
    playlistId: string | null
    loading: boolean
    shown: readonly string[] | undefined
  },
): RevealStep {
  if (view.source !== source) return { do: 'source' }
  if (view.playlistId !== RECENTLY_ADDED_ID) return { do: 'playlist' }
  if (view.loading || !view.shown) return { do: 'wait' }
  return view.shown.includes(trackId) ? { do: 'select', id: trackId } : { do: 'give-up' }
}

const PICKED: Partial<Record<PlaylistSource, (track: TrackItem) => boolean>> = {
  rekordbox: (t) => (t.rekordboxPlaylists?.length ?? 0) > 0,
}

export function revealableIn(
  track: TrackItem,
  recent: Partial<Record<PlaylistSource, readonly SourcePlaylistEntry[]>>,
): PlaylistSource[] {
  return pickedLibraries(track).filter((source) => {
    const entries = recent[source]
    return !!entries && playlistMembership(entries)(track)
  })
}

export function pickedLibraries(track: TrackItem): PlaylistSource[] {
  return (Object.keys(PICKED) as PlaylistSource[]).filter((source) => PICKED[source]?.(track))
}
