import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import type { LibrarySource } from '../lib/librarySource'
import { useWindowFocus } from './useWindowFocus'

// How long the session snapshot may stand before a refocus refreshes it. Long enough
// that flicking between apps doesn't dump the whole library each time, short enough that
// returning to Surco after adding songs elsewhere picks them up.
const REFRESH_AFTER_MS = 5 * 60_000

// The session snapshot of the destination library — Apple Music or the Engine DJ
// database, whichever the conversion destination points at — built once and matched
// against the whole crate locally so flagging "already owned" never spawns a process
// per track. `select` turns the raw candidates into the lookup index, memoized by React
// Query so its identity stays stable across renders (the App merge keys its view cache
// on it). Returns null with no source (destination is the folder / overwrite), before
// any track is loaded, or until the snapshot lands — those rows then carry an undefined
// library verdict and sit in neither filter bucket.
//
// The library changes outside Surco (songs added in Music, imports in Engine), so the
// snapshot can drift. A track Surco itself added is flagged from its own record
// regardless; to catch outside additions, the snapshot refreshes when the window
// regains focus — but only once it's older than REFRESH_AFTER_MS, so a quick alt-tab
// doesn't re-dump the library. Keying the query on the source keeps the two libraries'
// snapshots apart, so flipping the destination never shows one library's verdicts
// under the other's name.
export function useLibraryMembership(
  trackCount: number,
  source: LibrarySource,
): AppleMusicIndex | null {
  const queryClient = useQueryClient()
  const queryKey = ['library-membership', source]
  const { data } = useQuery({
    queryKey,
    queryFn: () =>
      source === 'engineDj' ? window.api.loadEngineLibrary() : window.api.loadAppleMusicLibrary(),
    enabled: source !== null && trackCount > 0,
    staleTime: Number.POSITIVE_INFINITY,
    select: buildLibraryIndex,
  })
  useWindowFocus((focused) => {
    if (!focused || source === null) return
    const state = queryClient.getQueryState(queryKey)
    if (state?.data && Date.now() - state.dataUpdatedAt > REFRESH_AFTER_MS) {
      void queryClient.invalidateQueries({ queryKey })
    }
  })
  return data ?? null
}
