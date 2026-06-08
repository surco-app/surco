import type { DiscogsRelease, DiscogsSearchResult, DiscogsTrack } from '../../../shared/types'
import type { TrackItem } from '../types'
import { bestMatch, confidenceTier, type TrackMatchTarget } from './release'

// The tracks an auto-match sweep should attempt: those not already carrying a Discogs
// match and holding the title plus search query a probe needs. Skipping tracks that
// already have a release id (auto-filled earlier or matched by hand) means a re-run
// only fills the gaps instead of re-tagging — and never clobbers the user's own pick.
export function tracksToAutoMatch(tracks: TrackItem[]): TrackItem[] {
  return tracks.filter(
    (t) =>
      !t.autoMatched &&
      !t.meta.discogsReleaseId &&
      t.query.trim() !== '' &&
      t.meta.title.trim() !== '',
  )
}

// What the sweep reads off a track to score release candidates against it.
export function matchTargetOf(track: TrackItem): TrackMatchTarget {
  return {
    title: track.meta.title,
    durationSec: track.duration,
    trackNumber: track.meta.trackNumber,
    artist: track.meta.artist,
  }
}

// How many search results to probe before giving up. Each probe loads a full
// release (one Discogs call), so this caps the calls one file can make — matching
// the editor browser's own auto-probe so manual and automatic matching agree.
export const MAX_AUTO_PROBE = 8

// The slice of the IPC surface auto-matching needs, narrowed so the sweep is
// testable with a stub instead of the whole window.api.
export interface DiscogsApi {
  searchDiscogs: (query: string) => Promise<DiscogsSearchResult[]>
  getRelease: (id: number) => Promise<DiscogsRelease>
}

export interface AutoMatch {
  release: DiscogsRelease
  track: DiscogsTrack
  confidence: number
}

// Headless counterpart to the editor's auto-probe: searches Discogs for the file
// and returns the first release whose best tracklist entry is 'high' confidence —
// the bar at which a match is safe to apply unattended. Only 'high' qualifies, so
// a merely plausible ('review') hit is left for the user's manual click. Stops at
// the first high hit to bound the API spend, and a failing search or release call
// skips rather than aborts the sweep so one bad row never sinks the whole crate.
export async function autoMatchRelease(
  query: string,
  target: TrackMatchTarget,
  api: DiscogsApi,
  maxProbe = MAX_AUTO_PROBE,
): Promise<AutoMatch | undefined> {
  if (!query.trim() || !target.title.trim()) return undefined
  let results: DiscogsSearchResult[]
  try {
    results = await api.searchDiscogs(query)
  } catch {
    return undefined
  }
  for (const result of results.slice(0, maxProbe)) {
    let rel: DiscogsRelease
    try {
      rel = await api.getRelease(result.id)
    } catch {
      continue
    }
    const m = bestMatch(rel.tracklist, target)
    if (m && confidenceTier(m.confidence) === 'high') {
      return { release: rel, track: m.track, confidence: m.confidence }
    }
  }
  return undefined
}
