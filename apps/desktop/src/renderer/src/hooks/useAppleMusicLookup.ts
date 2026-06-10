import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { AppleMusicLookupCandidate } from '../../../shared/types'

// How long the candidates must hold still before the library is queried. Each lookup
// spawns an osascript and the Editor remounts per track, so without this delay flipping
// through tracks or typing would spawn a process per keystroke.
const DEBOUNCE_MS = 600

// macOS-only hint of whether the song is already in the Apple Music library, used to
// avoid duplicate imports. Takes every artist/title pair worth asking about — the live
// tags plus the Discogs-suggested track when one is on screen — and reports 'yes' when
// any of them is in the library, so a song whose tags still hold the filename's rough
// spelling is caught under its canonical Discogs name too. Pairs missing either side
// can't identify a song, so only the complete ones are sent (none complete: no query).
// Keyed by the candidate list so the same song is only looked up once and revisiting it
// hits the cache; the array is rebuilt on every Editor render, so the key is its
// serialized form rather than its identity. keepPreviousData holds the last verdict on
// screen while a fresh one settles rather than flashing the badge off. Off macOS there
// is no library to query, so it reports 'idle' and the badge hides. 'pending' covers
// the gap between mount and the first verdict (debounce + osascript), so the badge
// slot can hold a skeleton instead of unmounting and reflowing the header.
export function useAppleMusicLookup(
  candidates: AppleMusicLookupCandidate[],
): 'idle' | 'pending' | 'yes' | 'no' {
  const complete = candidates.filter((c) => c.artist.trim() !== '' && c.title.trim() !== '')
  const key = JSON.stringify(complete.map((c) => [c.artist, c.title]))
  const eligible = window.api.platform === 'darwin' && complete.length > 0
  const [settled, setSettled] = useState(false)
  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the deliberate trigger, not a value read in the body — the debounce must re-arm on every candidate change (even while `eligible` stays true) so typing doesn't fire a lookup per keystroke.
  useEffect(() => {
    setSettled(false)
    if (!eligible) return
    const id = setTimeout(() => setSettled(true), DEBOUNCE_MS)
    return () => clearTimeout(id)
  }, [key, eligible])
  const { data, isError } = useQuery({
    queryKey: ['applemusic-lookup', key],
    queryFn: () => window.api.lookupAppleMusic(complete),
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
