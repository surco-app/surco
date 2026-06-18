import { useQuery, useQueryClient } from '@tanstack/react-query'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'
import { useWindowFocus } from './useWindowFocus'

const LIBRARY_KEY = ['applemusic-library']

// How long the session snapshot may stand before a refocus refreshes it. Long enough
// that flicking between apps doesn't dump the whole library each time, short enough that
// returning to Surco after adding songs in Music picks them up.
const REFRESH_AFTER_MS = 5 * 60_000

// The session snapshot of the Apple Music library, built once and matched against the
// whole crate locally so flagging "already owned" never spawns an osascript per track.
// Fetched automatically as soon as there are tracks to check (and only on macOS, where
// the Music bridge lives). `select` turns the raw pairs into the lookup index, memoized
// by React Query so its identity stays stable across renders (the App merge keys its view
// cache on it). Returns null until the snapshot lands, off macOS, or before any track is
// loaded — those rows then carry an undefined library verdict and sit in neither bucket.
//
// The library changes outside Surco (the user adds songs in Music), so the snapshot can
// drift. A track Surco itself adds is flagged from its persistent ID regardless; to catch
// songs added in Music, the snapshot refreshes when the window regains focus — but only
// once it's older than REFRESH_AFTER_MS, so a quick alt-tab doesn't re-dump the library.
export function useAppleMusicLibrary(trackCount: number): AppleMusicIndex | null {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: LIBRARY_KEY,
    queryFn: () => window.api.loadAppleMusicLibrary(),
    enabled: window.api.platform === 'darwin' && trackCount > 0,
    staleTime: Number.POSITIVE_INFINITY,
    select: buildLibraryIndex,
  })
  useWindowFocus((focused) => {
    if (!focused || window.api.platform !== 'darwin') return
    const state = queryClient.getQueryState(LIBRARY_KEY)
    if (state?.data && Date.now() - state.dataUpdatedAt > REFRESH_AFTER_MS) {
      void queryClient.invalidateQueries({ queryKey: LIBRARY_KEY })
    }
  })
  return data ?? null
}
