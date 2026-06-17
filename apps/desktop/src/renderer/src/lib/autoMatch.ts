import type { DiscogsRelease, DiscogsSearchResult, DiscogsTrack } from '../../../shared/types'
import type { TrackItem } from '../types'
import { bestMatch, confidenceTier, preRankResults, type TrackMatchTarget } from './release'

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
// release (one Discogs call), so this caps the calls one file can make — the editor
// browser's auto-probe and the sweep share it so manual and automatic matching agree.
export const MAX_AUTO_PROBE = 8

export interface ProbeMatch {
  release: DiscogsRelease
  track: DiscogsTrack
  confidence: number
}

// Walks search results in order, loading each release and scoring its tracklist
// against the target until one reaches the acceptance bar. The single probe loop
// behind both the sweep (accepts only 'high', safe to apply unattended) and the
// editor's auto-open (accepts 'review' too — it only highlights, never writes). A
// release that fails to load — or arrives structurally broken — is skipped, never
// thrown; `cancelled` lets a superseding search stop the walk between loads.
export async function probeReleases(
  results: DiscogsSearchResult[],
  target: TrackMatchTarget,
  opts: {
    loadRelease: (id: number) => Promise<DiscogsRelease>
    accepts: (tier: 'high' | 'review' | 'low') => boolean
    maxProbe?: number
    cancelled?: () => boolean
  },
): Promise<ProbeMatch | undefined> {
  for (const result of preRankResults(results, target).slice(0, opts.maxProbe ?? MAX_AUTO_PROBE)) {
    if (opts.cancelled?.()) return undefined
    let rel: DiscogsRelease
    let m: ReturnType<typeof bestMatch>
    try {
      rel = await opts.loadRelease(result.id)
      m = bestMatch(rel.tracklist, target)
    } catch {
      continue
    }
    if (opts.cancelled?.()) return undefined
    if (m && opts.accepts(confidenceTier(m.confidence))) {
      return { release: rel, track: m.track, confidence: m.confidence }
    }
  }
  return undefined
}

// The slice of the IPC surface auto-matching needs, narrowed so the sweep is
// testable with a stub instead of the whole window.api.
export interface DiscogsApi {
  searchDiscogs: (query: string) => Promise<DiscogsSearchResult[]>
  getRelease: (id: number) => Promise<DiscogsRelease>
}

export type AutoMatch = ProbeMatch

// Headless counterpart to the editor's auto-probe: searches Discogs for the file
// and returns the first release whose best tracklist entry is 'high' confidence —
// the bar at which a match is safe to apply unattended. Only 'high' qualifies, so
// a merely plausible ('review') hit is left for the user's manual click. A failing
// search skips rather than aborts the sweep so one bad row never sinks the crate.
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
  return probeReleases(results, target, {
    loadRelease: api.getRelease,
    accepts: (tier) => tier === 'high',
    maxProbe,
  })
}
