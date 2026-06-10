import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

// How long the title/artist must hold still before the library is queried. Each lookup
// spawns an osascript and the Editor remounts per track, so without this delay flipping
// through tracks or typing would spawn a process per keystroke.
const DEBOUNCE_MS = 600

// macOS-only hint of whether the song is already in the Apple Music library, used to
// avoid duplicate imports. Keyed by title+artist so the same song is only looked up
// once and revisiting it hits the cache. keepPreviousData holds the last verdict on
// screen while a fresh one settles rather than flashing the badge off. Off macOS there
// is no library to query, so it reports 'idle' and the badge hides. 'pending' covers
// the gap between mount and the first verdict (debounce + osascript), so the badge
// slot can hold a skeleton instead of unmounting and reflowing the header.
export function useAppleMusicLookup(
  artist: string,
  title: string,
): 'idle' | 'pending' | 'yes' | 'no' {
  const eligible = window.api.platform === 'darwin' && artist.trim() !== '' && title.trim() !== ''
  const [settled, setSettled] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: artist and title are the deliberate triggers, not values read in the body — the debounce must re-arm on every edit (even while `eligible` stays true) so typing doesn't fire a lookup per keystroke.
  useEffect(() => {
    setSettled(false)
    if (!eligible) return
    const id = setTimeout(() => setSettled(true), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [artist, title, eligible])
  const { data, isError } = useQuery({
    queryKey: ['applemusic-lookup', artist, title],
    queryFn: () => window.api.lookupAppleMusic(artist, title),
    enabled: eligible && settled,
    // The library can change within a session (the user may add the track), so re-check
    // on each selection rather than trusting the session-long cache the probes use.
    staleTime: 0,
    placeholderData: keepPreviousData,
  })
  if (!eligible || isError) return 'idle'
  if (data === undefined) return 'pending'
  return data ? 'yes' : 'no'
}
