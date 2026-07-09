import { cleanMatchTitle, stripIgnoredWords } from '../../../shared/searchClean'
import type { Release, ReleaseTrack, SearchProviderId, SearchResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import type { LocalActivityReport } from './activityLog'
import { keepCoverArg } from './coverSource'
import { unformatTitle } from './outputName'
import {
  bestMatch,
  boostForCatalogMatch,
  buildReleaseMeta,
  catalogNumberMatches,
  confidenceTier,
  corroboratedTier,
  type MatchSignals,
  matchSignals,
  preRankResults,
  type TrackMatchTarget,
} from './release'

// The tracks an auto-match sweep should attempt: those not already carrying a Discogs
// match and holding the title plus search query a probe needs. Skipping tracks already
// matched or under review means a re-run only fills the gaps instead of re-tagging — and
// never clobbers the user's own pick. A track carrying a discogsReleaseId is still
// attempted: autoMatchRelease tries that exact release first, so a re-run over an
// already-tagged crate re-confirms it directly instead of skipping it outright.
export function tracksToAutoMatch(tracks: TrackItem[]): TrackItem[] {
  return tracks.filter(
    (t) =>
      !t.autoMatched &&
      !t.matched &&
      // A review-flagged track already has a pending suggestion waiting for the user's
      // glance; re-probing it on every sweep would churn the same call and overwrite that
      // pending state, so leave it until the user confirms or clears it.
      !t.matchReview &&
      t.query.trim() !== '' &&
      t.meta.title.trim() !== '',
  )
}

// The user's search-hygiene settings the matcher cleans a title with before scoring —
// threaded from Settings by the sweep and the editor alike so the two score identically.
export interface MatchCleanup {
  titleFormat?: string
  ignoreWords?: string[]
}

// What the sweep reads off a track to score release candidates against it.
export function matchTargetOf(track: TrackItem, cleanup: MatchCleanup = {}): TrackMatchTarget {
  // The user's junk phrases go first: a rip stamp can sit inside the Naming pattern's
  // dressing ("(A2) Song rip crew (1998)"), where it would keep the pattern's suffix
  // from lining up and sink the undressing below.
  const stripped = stripIgnoredWords(track.meta.title, cleanup.ignoreWords ?? [])
  // Undress the configured Naming pattern next: the app's own "(A2) Title (1998)"
  // format must never bury its re-match — and the track number the pattern wrapped is
  // recovered for the position signal when the file carries none of its own.
  const un = cleanup.titleFormat ? unformatTitle(cleanup.titleFormat, stripped) : undefined
  return {
    // Score against a cleaned title: a file whose title tag is really the whole (often
    // duplicated) file name would otherwise never reach the confidence bar.
    title: cleanMatchTitle(un?.title ?? stripped),
    durationSec: track.duration,
    trackNumber: track.meta.trackNumber || un?.fields.trackNumber,
    artist: track.meta.artist,
    catalogNumber: track.meta.catalogNumber,
    year: track.meta.year,
    discogsReleaseId: track.meta.discogsReleaseId,
  }
}

// The track patch that accepts a persisted 'review' suggestion: applies its stored release
// exactly like clicking the match in the editor (same buildReleaseMeta + keep-the-file's-cover
// policy the sweep uses), then clears the pending review state and guards the row from a
// re-probe. Returns undefined when there's nothing to accept, so the caller stays a no-op.
export function acceptReviewPatch(track: TrackItem): Partial<TrackItem> | undefined {
  const rm = track.reviewMatch
  if (!rm) return undefined
  const patch = buildReleaseMeta(track.meta, rm.release, rm.track, keepCoverArg(track))
  return {
    meta: patch.meta,
    coverUrl: patch.coverUrl,
    coverPath: patch.coverPath,
    matched: true,
    autoMatched: true,
    matchProvider: rm.release.provider,
    matchReview: false,
    reviewMatch: undefined,
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
  // The probe's guarded verdict: confidenceTier demoted to 'review' when nothing beyond
  // the title corroborates the hit (corroboratedTier). Callers must act on this, never
  // re-derive a tier from the raw confidence — a demoted match still carries a confidence
  // above the high bar, and re-deriving would apply exactly what the guard flagged.
  tier: 'high' | 'review' | 'low'
  // The search-result row that produced this match. Carried back because a release is
  // identified by its provider+result row, not by Release.id alone (Bandcamp's parsed
  // release id can differ from the autocomplete id, and the row holds the page URL).
  result: SearchResult
  // Which title-independent evidence the guard saw, per signal — the "why" behind the
  // tier, carried out so the activity feed can explain the verdict.
  signals: MatchSignals
}

// One scored candidate the probe walked. Streamed out through `onProbe` so the activity
// feed can show what was considered and rejected, not just the winner.
export interface ProbedCandidate {
  result: SearchResult
  confidence: number
  tier: 'high' | 'review' | 'low'
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
    // Called once per scored candidate, accepted or not — the raw trail behind the
    // verdict, surfaced in the activity feed.
    onProbe?: (candidate: ProbedCandidate) => void
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
    const catalogMatched = catalogNumberMatches(target.catalogNumber, rel)
    const confidence = catalogMatched ? boostForCatalogMatch(m.confidence) : m.confidence
    const tier = corroboratedTier(confidence, target, rel, m.track, catalogMatched)
    const signals = matchSignals(target, rel, m.track, catalogMatched)
    opts.onProbe?.({ result, confidence, tier })
    if (confidence >= (opts.minConfidence ?? 0) && opts.accepts(tier)) {
      return { release: rel, track: m.track, confidence, tier, result, signals }
    }
    // Keep walking for an accepted match, but remember the strongest review-tier hit in case
    // none turns up — the probe order isn't confidence order, so the best review can sit
    // behind a weaker one.
    if (opts.collectReview && tier === 'review' && (!review || confidence > review.confidence)) {
      review = { release: rel, track: m.track, confidence, tier, result, signals }
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

// Tries the file's own stored release before any text search: loads it directly by id,
// scores its tracklist the same way a probed search result would, and accepts anything
// 'high' or 'review'. The tier comes from the raw confidence, NOT the corroboration
// guard: that guard keeps a title-only TEXT-SEARCH hit from writing another act's tags,
// but a stored id carries no such risk — the id itself names the disc (a previous match
// or the user's own hand), so the only question left is which track on it is this file.
// Demoting here stalled every no-durations vinyl as a review suggestion the sweep never
// revisits. Returns undefined on any failure (release deleted, load error, no acceptable
// track), letting the caller fall back to a text search exactly as if there were no id.
async function matchStoredRelease(
  discogsReleaseId: string,
  target: TrackMatchTarget,
  api: SearchApi,
  onProbe?: (candidate: ProbedCandidate) => void,
): Promise<AutoMatch | undefined> {
  const result: SearchResult = { provider: 'discogs', id: Number(discogsReleaseId), title: '' }
  let rel: Release
  let m: ReturnType<typeof bestMatch>
  try {
    rel = await api.getRelease(result)
    m = bestMatch(rel.tracklist, target)
  } catch {
    return undefined
  }
  if (!m) return undefined
  const catalogMatched = catalogNumberMatches(target.catalogNumber, rel)
  const confidence = catalogMatched ? boostForCatalogMatch(m.confidence) : m.confidence
  const tier = confidenceTier(confidence)
  const signals = matchSignals(target, rel, m.track, catalogMatched)
  onProbe?.({ result, confidence, tier })
  if (tier === 'low') return undefined
  return { release: rel, track: m.track, confidence, tier, result, signals }
}

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
  onProbe?: (candidate: ProbedCandidate) => void,
): Promise<AutoMatch | undefined> {
  if (!query.trim() || !target.title.trim()) return undefined
  // A review-tier suggestion held while other options are still tried: a high match
  // anywhere outranks it, so it's only returned once nothing scores high.
  let review: AutoMatch | undefined
  // A file already carrying a Discogs release id gets that exact release re-loaded, and if
  // it holds a plausible track for this file, that's the answer — the id names the disc, so
  // no title search or fallback source runs at all (searching anyway would surface other
  // pressings next to a release we already know). A 'high' applies unattended and a 'review'
  // comes back for a glance, same tiers as ever; only a dead end (release gone, no acceptable
  // track on it) falls through to the normal search below.
  if (target.discogsReleaseId) {
    const stored = await matchStoredRelease(target.discogsReleaseId, target, api, onProbe)
    if (stored) return stored
  }
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
      onProbe,
    })
    if (match) {
      if (match.tier === 'high') return match
      // A Discogs review suggestion: hold it, but keep trying the other sources for a high
      // match that would win outright.
      review ??= match
    }
  }
  return review
}

// The provider names are brand names, shown verbatim in every language.
const PROVIDER_NAME: Record<SearchProviderId, string> = {
  discogs: 'Discogs',
  bandcamp: 'Bandcamp',
}

function pct(confidence: number): number {
  return Math.round(confidence * 100)
}

function mark(fired: boolean): string {
  return fired ? '✓' : '✗'
}

// Where the chosen release lives on the web, for the row's open-in-browser affordance —
// the same link the release-load activity entry carries (Discogs builds it from the id,
// Bandcamp's search row already holds its page URL).
function releasePageUrl(m: ProbeMatch): string | undefined {
  return m.release.provider === 'discogs'
    ? `https://www.discogs.com/release/${m.release.id}`
    : m.result.releaseUrl
}

// Turns one probe verdict into an activity-feed entry that explains itself: which release
// won (or was only suggested), the confidence, a ✓/✗ per corroboration signal, and every
// candidate the walk scored — the debug trail the user asked the panel to show. Scaffold
// words live in the i18n strings; the params are pure data (titles, numbers, marks), so a
// language switch retranslates the row like any main-process entry.
export function matchActivityReport(
  trackTitle: string,
  m: ProbeMatch | undefined,
  probes: ProbedCandidate[],
  ms: number,
): LocalActivityReport {
  const candidates = probes
    .map((p) => `${PROVIDER_NAME[p.result.provider]} · ${p.result.title} — ${pct(p.confidence)} %`)
    .join('\n')
  if (!m) {
    return {
      kind: 'match',
      labelKey: 'activity.autoMatchNone',
      labelParams: { track: trackTitle },
      ...(probes.length
        ? { detailKey: 'activity.autoMatchNoneDetail', detailParams: { candidates } }
        : { detailKey: 'activity.autoMatchNoCandidates' }),
      ms,
    }
  }
  const applied = m.tier === 'high'
  // A review verdict reads differently by cause: a raw-high score demoted by the guard
  // ("nothing beyond the title corroborates it") vs a score under the auto-apply bar.
  const demoted = !applied && confidenceTier(m.confidence) === 'high'
  return {
    kind: 'match',
    labelKey: applied ? 'activity.autoMatchApplied' : 'activity.autoMatchReview',
    labelParams: { track: trackTitle },
    detailKey: applied
      ? 'activity.autoMatchAppliedDetail'
      : demoted
        ? 'activity.autoMatchReviewUncorroboratedDetail'
        : 'activity.autoMatchReviewLowDetail',
    detailParams: {
      release: m.result.title,
      track: [m.track.position, m.track.title].filter(Boolean).join('. '),
      confidence: pct(m.confidence),
      duration: mark(m.signals.durations),
      artist: mark(m.signals.artistAgrees),
      catno: mark(m.signals.catalogMatched),
      candidates,
    },
    ms,
    url: releasePageUrl(m),
  }
}
