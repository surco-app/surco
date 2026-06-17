import { useQuery } from '@tanstack/react-query'
import { type AppleMusicIndex, buildLibraryIndex } from '../lib/appleMusicLibrary'

// The session snapshot of the Apple Music library, built once and matched against the
// whole crate locally so flagging "already owned" never spawns an osascript per track.
// Fetched automatically as soon as there are tracks to check (and only on macOS, where
// the Music bridge lives), then held for the session: the library changes when the user
// adds songs in Music, not while they work in Surco, so a re-fetch per import would be
// wasted — a track Surco itself adds is flagged from its persistent ID instead. `select`
// turns the raw pairs into the lookup index, memoized by React Query so its identity
// stays stable across renders (the App merge keys its view cache on it). Returns null
// until the snapshot lands, off macOS, or before any track is loaded — those rows then
// carry an undefined library verdict and sit in neither filter bucket.
export function useAppleMusicLibrary(trackCount: number): AppleMusicIndex | null {
  const { data } = useQuery({
    queryKey: ['applemusic-library'],
    queryFn: () => window.api.loadAppleMusicLibrary(),
    enabled: window.api.platform === 'darwin' && trackCount > 0,
    staleTime: Number.POSITIVE_INFINITY,
    select: buildLibraryIndex,
  })
  return data ?? null
}
