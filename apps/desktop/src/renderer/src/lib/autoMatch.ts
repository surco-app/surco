import { cleanMatchTitle } from '../../../shared/searchClean'
import type { Release, ReleaseTrack, SearchProviderId, SearchResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import {
  bestMatch,
  boostForCatalogMatch,
  catalogNumberMatches,
  confidenceTier,
  preRankResults,
  type TrackMatchTarget,
} from './release'

// The tracks an auto-match sweep should attempt: those not already carrying a Discogs
// match and holding the title plus search query a probe needs. Skipping tracks that
// already have a release id (auto-filled earlier or matched by hand) means a re-run
// only fills the gaps instead of re-tagging — and never clobbers the user's own pick.
export function tracksToAutoMatch(tracks: TrackItem[]): TrackItem[] {
  return tracks.filter(
    (t) =>
      !t.autoMatched &&
      !t.matched &&
      // A review-flagged track already has a pending suggestion waiting for the user's
      // glance; re-probing it on every sweep would churn the same call and overwrite that
      // pending state, so leave it until the user confirms or clears it.
      !t.matchReview &&
      !t.meta.discogsReleaseId &&
      t.query.trim() !== '' &&
      t.meta.title.trim() !== '',
  )
}

// What the sweep reads off a track to score release candidates against it.
export function matchTargetOf(track: TrackItem): TrackMatchTarget {
  return {
    // Score against a cleaned title: a file whose title tag is really the whole (often
    // duplicated) file name would otherwise never reach the confidence bar.
    title: cleanMatchTitle(track.meta.title),
    durationSec: track.duration,
    trackNumber: track.meta.trackNumber,
    artist: track.meta.artist,
    catalogNumber: track.meta.catalogNumber,
  }
}

// How many search results to probe before giving up. Each probe loads a full
// release (one Discogs call), so this caps the calls one file can make — the editor
// browser's auto-probe and the sweep share it so manual and automatic matching agree.
export const MAX_AUTO_PROBE = 8

export interface ProbeMatch {
  release: Release
  track: ReleaseTrack
  confidence: number
  // The search-result row that produced this match. Carried back because a release is
  // identified by its provider+result row, not by Release.id alone (Bandcamp's parsed
  // release id can differ from the autocomplete id, and the row holds the page URL).
  result: SearchResult
}

// Walks search results in order, loading each release and scoring its tracklist
// against the target until one reaches the acceptance bar. The single probe loop
// behind both the sweep (accepts only 'high', safe to apply unattended) and the
// editor's auto-open (accepts 'review' too — it only highlights, never writes). A
// release that fails to load — or arrives structurally broken — is skipped, never
// thrown; `cancelled` lets a superseding search stop the walk between loads.
export async function probeReleases(
  results: SearchResult[],
  target: TrackMatchTarget,
  opts: {
    loadRelease: (result: SearchResult) => Promise<Release>
    accepts: (tier: 'high' | 'review' | 'low') => boolean
    // A floor on the raw confidence, on top of the tier check. Used to hold an uncurated
    // source (Bandcamp) to a stricter bar than the curated one before applying unattended.
    minConfidence?: number
    // When set, the best 'review'-tier match seen while hunting for an accepted one is
    // returned as a fallback if nothing clears `accepts` — so the sweep can flag a
    // plausible-but-uncertain suggestion for the user without a second pass of release loads.
    collectReview?: boolean
    maxProbe?: number
    cancelled?: () => boolean
  },
): Promise<ProbeMatch | undefined> {
  let review: ProbeMatch | undefined
  for (const result of preRankResults(results, target).slice(0, opts.maxProbe ?? MAX_AUTO_PROBE)) {
    if (opts.cancelled?.()) return undefined
    let rel: Release
    let m: ReturnType<typeof bestMatch>
    try {
      rel = await opts.loadRelease(result)
      m = bestMatch(rel.tracklist, target)
    } catch {
      continue
    }
    if (opts.cancelled?.()) return undefined
    if (!m) continue
    // A file's catalog number matching one of the release's pressings is the strongest
    // evidence it names this exact release, so it lifts the confidence — enough to carry a
    // review-tier hit over the high bar and apply it unattended. The boosted score drives
    // every downstream decision (the accept bar, the fallback floor, the review fallback).
    const confidence = catalogNumberMatches(target.catalogNumber, rel)
      ? boostForCatalogMatch(m.confidence)
      : m.confidence
    if (confidence >= (opts.minConfidence ?? 0) && opts.accepts(confidenceTier(confidence))) {
      return { release: rel, track: m.track, confidence, result }
    }
    // Keep walking for an accepted match, but remember the strongest review-tier hit in case
    // none turns up — the probe order isn't confidence order, so the best review can sit
    // behind a weaker one.
    if (
      opts.collectReview &&
      confidenceTier(confidence) === 'review' &&
      (!review || confidence > review.confidence)
    ) {
      review = { release: rel, track: m.track, confidence, result }
    }
  }
  return opts.collectReview ? review : undefined
}

// The slice of the IPC surface auto-matching needs, narrowed so the sweep is
// testable with a stub instead of the whole window.api.
export interface SearchApi {
  search: (query: string, provider: SearchProviderId) => Promise<SearchResult[]>
  getRelease: (result: SearchResult) => Promise<Release>
  // Sources to try, in order; omitted means Discogs only. Discogs is always tried first
  // (autoMatchRelease enforces it) as the curated source; the rest are a fallback.
  providers?: SearchProviderId[]
}

export type AutoMatch = ProbeMatch

// A non-Discogs source must clear a higher confidence floor than Discogs' 'high' before
// auto-applying: Bandcamp's catalog is uncurated (bootlegs, re-uploads, DJ sets that carry
// the track's name), so a borderline-'high' title hit there is far likelier to be wrong.
const FALLBACK_MIN_CONFIDENCE = 0.92

// Discogs is the curated source, so it leads regardless of the stored order; the rest
// follow as fallbacks.
function discogsFirst(providers: SearchProviderId[]): SearchProviderId[] {
  return providers.includes('discogs')
    ? ['discogs', ...providers.filter((p) => p !== 'discogs')]
    : providers
}

// Headless counterpart to the editor's auto-probe: searches each configured source for the
// file and returns the first release whose best tracklist entry clears the bar — the point
// at which a match is safe to apply unattended. Discogs goes first at its 'high' bar; if it
// finds nothing, a fallback source (Bandcamp) is tried, but only for files that carry a
// duration (the signal that corroborates an uncurated hit) and at a stricter floor. A
// failing search skips to the next source rather than aborting, so one bad row never sinks
// the crate.
export async function autoMatchRelease(
  query: string,
  target: TrackMatchTarget,
  api: SearchApi,
  maxProbe = MAX_AUTO_PROBE,
): Promise<AutoMatch | undefined> {
  if (!query.trim() || !target.title.trim()) return undefined
  // A review-tier suggestion from the curated source, held while the other sources are still
  // tried: a high match anywhere outranks it, so it's only returned once nothing scores high.
  let review: AutoMatch | undefined
  for (const provider of discogsFirst(api.providers ?? ['discogs'])) {
    // No duration to cross-check against → don't trust an uncurated catalog unattended.
    if (provider !== 'discogs' && target.durationSec === undefined) continue
    let results: SearchResult[]
    try {
      results = await api.search(query, provider)
    } catch {
      continue
    }
    const match = await probeReleases(results, target, {
      loadRelease: api.getRelease,
      accepts: (tier) => tier === 'high',
      minConfidence: provider === 'discogs' ? undefined : FALLBACK_MIN_CONFIDENCE,
      // Only the curated source may suggest a review-tier match: an uncurated catalog's
      // borderline title hit is noise, never worth flagging for a human glance.
      collectReview: provider === 'discogs',
      maxProbe,
    })
    if (match) {
      if (confidenceTier(match.confidence) === 'high') return match
      // A Discogs review suggestion: hold it, but keep trying the other sources for a high
      // match that would win outright.
      review ??= match
    }
  }
  return review
}
