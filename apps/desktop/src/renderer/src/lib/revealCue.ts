import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { PlaylistSource } from '../../../shared/types'

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
