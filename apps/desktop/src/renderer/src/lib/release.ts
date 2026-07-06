import type {
  Release,
  ReleaseTrack,
  SearchProviderId,
  SearchResult,
  TrackMetadata,
} from '../../../shared/types'
import { parseDuration } from './duration'
import { foldText } from './normalizeText'
import { splitPosition } from './position'

export function cleanName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '')
}

export function joinArtists(artists?: { name: string }[]): string {
  return (artists ?? []).map((a) => cleanName(a.name)).join(', ')
}

export function coverOf(release: Release, fallback?: string): string | undefined {
  return (
    release.images?.find((i) => i.type === 'primary')?.uri ?? release.images?.[0]?.uri ?? fallback
  )
}

// Steps through a release's images with wraparound, given the URL currently shown.
// Returns -1 when there are no images. When the current cover isn't one of them
// (e.g. the user dropped their own), the first step lands on image 0 so the arrows
// always have a defined starting point.
export function stepImageIndex(
  images: { uri: string }[],
  currentUrl: string | undefined,
  delta: number,
): number {
  if (images.length === 0) return -1
  const current = images.findIndex((i) => i.uri === currentUrl)
  if (current === -1) return 0
  return (current + delta + images.length) % images.length
}

// A release fetched by id has no search-result row to show, so synthesise one
// from the release itself — the list and tracklist UI then work unchanged.
export function resultFromRelease(rel: Release): SearchResult {
  const albumArtist = joinArtists(rel.artists)
  return {
    provider: rel.provider,
    id: rel.id,
    title: albumArtist ? `${albumArtist} - ${rel.title}` : rel.title,
    year: rel.year ? String(rel.year) : undefined,
    thumb: coverOf(rel),
    label: rel.labels?.map((l) => l.name),
  }
}

// The query-cache key for a loaded release. Keyed by provider and id together so a Discogs
// and a Bandcamp release that happen to share a numeric id never collide in the cache. The
// prefetch and the open-release query both build it here, so they address the exact same
// entry — a drift between the two keys would re-fetch instead of reading the warmed cache.
// Accepts null (no release open) so the disabled query still has a stable key shape.
export function releaseKey(result: Pick<SearchResult, 'provider' | 'id'> | null) {
  return ['release', result?.provider, result?.id] as const
}

export function normalize(s: string): string {
  return foldText(s)
}

// What we know about the file, used to score each tracklist entry. Every field
// past the title is optional: a release may carry no track durations, and a file
// may have no track number or artist tag — a missing signal is simply not scored.
export interface TrackMatchTarget {
  title: string
  durationSec?: number
  trackNumber?: string
  artist?: string
  // The file's catalog number, if tagged. Not a per-track score (it's a release-level fact);
  // it boosts the whole release's confidence when it matches one of the release's pressings.
  catalogNumber?: string
  // The file's release year, if tagged. Only a ranking tie-break — reissues are legitimate, so
  // a differing year must never penalise a match — it just floats the pressing that shares the
  // file's year ahead of an equally-relevant reissue so the right one is probed first.
  year?: string
}

export interface ScoredTrack {
  track: ReleaseTrack
  confidence: number
}

// Each signal's share of the confidence. Title leads, but duration is nearly as
// telling: within one release the titles can be near-identical ("Mix", "Edit")
// while the lengths are unique, so a close duration is what pins the right track.
export interface ScoreWeights {
  title: number
  duration: number
  position: number
  artist: number
}

const DEFAULT_WEIGHTS: ScoreWeights = {
  title: 0.45,
  duration: 0.4,
  position: 0.1,
  artist: 0.05,
}

// A file's probed length and Discogs' rounded "m:ss" rarely agree to the second,
// so treat anything within DURATION_EXACT_SEC as a perfect hit and fade linearly
// to nothing by DURATION_MISS_SEC, past which it's a different track.
const DURATION_EXACT_SEC = 2
const DURATION_MISS_SEC = 8

export function titleSimilarity(target: string, candidate: string): number {
  const a = normalize(target)
  const b = normalize(candidate)
  if (!a || !b) return 0
  if (a === b) return 1
  // A candidate that merely appends words to the file's title — the common case where
  // Discogs spells out "(Original Mix)" the file omits — is still the same track, so it
  // stays a strong match. But the reverse, a candidate that drops words the file's title
  // carries (a bare "Acid" against the file's "Acid (Extended Mix)"), is missing the very
  // version asked for: score it by how little of the title it covers so it can't outrank
  // a track that keeps a matching mix. This is what pins the right version when Discogs
  // lists no durations to separate the cuts.
  if (b.includes(a)) return 0.7
  if (a.includes(b)) return 0.5 * (b.split(' ').length / a.split(' ').length)
  const targetWords = a.split(' ')
  const candidateWords = new Set(b.split(' '))
  // Same words in a different order ("Love All" vs "All Love", "X vs Y" vs "Y vs X") are
  // almost certainly the same title — score them high so a duration tie doesn't bury the
  // right track under a reordering the substring check above can't see.
  const targetSet = new Set(targetWords)
  if (targetSet.size === candidateWords.size && [...targetSet].every((w) => candidateWords.has(w)))
    return 0.9
  const shared = targetWords.filter((w) => candidateWords.has(w)).length
  return shared ? 0.6 * (shared / targetWords.length) : 0
}

// How close two lengths are, 1 (within DURATION_EXACT_SEC) fading linearly to 0 (past
// DURATION_MISS_SEC). Shared by the Discogs scorer (which parses an "m:ss" string first)
// and the Apple Music library matcher (which compares two probed second counts).
export function durationProximitySec(aSec: number, bSec: number): number {
  const delta = Math.abs(aSec - bSec)
  if (delta <= DURATION_EXACT_SEC) return 1
  if (delta >= DURATION_MISS_SEC) return 0
  return (DURATION_MISS_SEC - delta) / (DURATION_MISS_SEC - DURATION_EXACT_SEC)
}

function durationProximity(
  localSec: number,
  trackDuration: string | undefined,
): number | undefined {
  const trackSec = parseDuration(trackDuration)
  if (trackSec === undefined) return undefined
  return durationProximitySec(localSec, trackSec)
}

function positionMatch(trackNumber: string, position: string): number | undefined {
  const candidate = splitPosition(position).track
  if (!candidate) return undefined
  return candidate === trackNumber ? 1 : 0
}

function artistMatch(target: string, artists: { name: string }[] | undefined): number | undefined {
  if (!artists?.length) return undefined
  const a = normalize(target)
  const b = normalize(joinArtists(artists))
  if (!b) return undefined
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.7
  return 0
}

// Scores how strongly a tracklist entry matches the file, 0–1. Each signal
// contributes its weight only when both sides carry it, and the weights are
// renormalised over the signals actually present — so a release with no track
// durations is judged on title alone rather than dragged down by the gap.
export function scoreTrack(
  track: ReleaseTrack,
  target: TrackMatchTarget,
  weights: ScoreWeights = DEFAULT_WEIGHTS,
): number {
  let weighted = 0
  let total = 0
  const add = (weight: number, score: number | undefined): void => {
    if (score === undefined) return
    weighted += weight * score
    total += weight
  }
  if (normalize(target.title)) add(weights.title, titleSimilarity(target.title, track.title))
  if (target.durationSec !== undefined)
    add(weights.duration, durationProximity(target.durationSec, track.duration))
  if (target.trackNumber) add(weights.position, positionMatch(target.trackNumber, track.position))
  if (target.artist) add(weights.artist, artistMatch(target.artist, track.artists))
  return total === 0 ? 0 : weighted / total
}

// Mirrors Meta's "Match Tracks: Automatically": picks the tracklist entry that
// best matches the file (title, then duration, position and artist), so the
// right mix is preselected instead of the user hunting for it. Returns the
// winner with its confidence, or undefined when nothing scores above zero.
export function bestMatch(
  tracks: ReleaseTrack[],
  target: TrackMatchTarget,
): ScoredTrack | undefined {
  let best: ScoredTrack | undefined
  for (const track of tracks) {
    const confidence = scoreTrack(track, target)
    if (confidence > 0 && (!best || confidence > best.confidence)) best = { track, confidence }
  }
  return best
}

// Above HIGH the signals agree closely enough to apply the match unattended; the
// band down to REVIEW is plausible but worth a human glance; below that it is too
// weak to trust. The UI labels the preselected track by tier, and a batch
// auto-match (planned) will apply 'high' outright and queue 'review' for a look.
const HIGH_CONFIDENCE = 0.85
const REVIEW_CONFIDENCE = 0.6

export function confidenceTier(confidence: number): 'high' | 'review' | 'low' {
  if (confidence >= HIGH_CONFIDENCE) return 'high'
  if (confidence >= REVIEW_CONFIDENCE) return 'review'
  return 'low'
}

// Folds a catalog number to its bare identity so the same pressing matches across the
// cosmetic ways it's written: "SR-001", "SR 001" and "sr001" are one number. Discogs' "none"
// placeholder for white labels is dropped to empty so it never matches another blank.
function foldCatalogNumber(catno: string | undefined): string {
  const bare = (catno ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return bare === 'none' ? '' : bare
}

// Whether the file's catalog number names one of the release's pressings. The catno is the
// strongest evidence a file names the exact release (Discogs' own note calls it the key that
// distinguishes pressings), so a match is worth boosting the confidence — but only a real
// number on both sides counts, never two blanks.
export function catalogNumberMatches(fileCatno: string | undefined, rel: Release): boolean {
  const file = foldCatalogNumber(fileCatno)
  if (!file) return false
  return (rel.labels ?? []).some((l) => foldCatalogNumber(l.catno) === file)
}

// The lift a confirmed catalog-number match adds to a track's confidence. Sized to carry a
// review-tier match (≥0.60) over the high bar (0.85) so it applies unattended, while leaving
// a low-tier score (<0.60) below the review bar — a matching catno on an otherwise-wrong track
// is more likely a shared pressing of a different cut than a correct hit, so it can't rescue
// noise. Clamped so it never exceeds a perfect score.
const CATALOG_MATCH_BOOST = 0.25
export function boostForCatalogMatch(base: number): number {
  return Math.min(1, base + CATALOG_MATCH_BOOST)
}

// Discogs leads, Bandcamp is the fallback — the same precedence the headless sweep uses
// (discogsFirst): Discogs is the canonical catalog for this music and carries the
// tracklists/durations the suggestion scores against, so between two equally-relevant rows
// the Discogs one leads and Bandcamp stays the fallback. A tie-break only, never the primary
// key: with Discogs holding nothing but noise for a query, an unconditional provider sort
// pinned unrelated Discogs rows above Bandcamp's exact release (real case: "Save My Love
// DJ Mofly" listed Zappa and Champs Elysées first and the right release dead last). The sort
// is stable, so Discogs' order stands as the final tie-break and equally-relevant rows keep
// their place.
const PROVIDER_RANK: Record<SearchProviderId, number> = { discogs: 0, bandcamp: 1 }

const COMPILATION_PENALTY = 1

// A various-artist set / compilation, tagged by Discogs in the result's `format`. These are
// the dominant noise: their titles often carry the searched artist/title words, so on pure
// text overlap they tie or beat the artist's own release and bury it.
function isCompilation(result: SearchResult): boolean {
  return (result.format ?? []).some((f) => f.toLowerCase() === 'compilation')
}

export function preRankResults(results: SearchResult[], target: TrackMatchTarget): SearchResult[] {
  const relevance = (result: SearchResult): number => {
    const hay = normalize(`${result.title} ${(result.label ?? []).join(' ')}`)
    const fraction = (field: string | undefined): number => {
      const words = field ? normalize(field).split(' ').filter(Boolean) : []
      if (!words.length) return 0
      return words.filter((w) => hay.includes(w)).length / words.length
    }
    // Artist is the reliable signal — a full artist match all but names the release — so
    // it outweighs the title, which often isn't in the "Artist - Album" row at all. A
    // compilation is then docked so an equally-relevant proper release outranks it, without
    // dropping it (a track may only exist on a compilation, and the probe still scores it).
    const score = 2 * fraction(target.artist) + fraction(target.title)
    return score - (isCompilation(result) ? COMPILATION_PENALTY : 0)
  }
  // A pressing whose year matches the file's tag is the edition the file came from, so it
  // breaks a relevance tie ahead of an equally-relevant reissue and gets probed first. Ranked
  // above `have` because the file's own year is more specific than raw popularity. A tie-break
  // only: reissues are legitimate, so a differing year never penalises — it just doesn't lift.
  const yearMatch = (result: SearchResult): number =>
    target.year && result.year && result.year === target.year ? 1 : 0
  // Community ownership ("have") breaks remaining ties between equally-relevant rows so the
  // canonical pressing — the one most people own — floats above the obscure repress. Only a
  // tie-break: it never overrides relevance, and Bandcamp/sparse rows (no stats) just score 0.
  const have = (result: SearchResult): number => result.community?.have ?? 0
  return results
    .map((result, index) => ({ result, index, score: relevance(result) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        PROVIDER_RANK[a.result.provider] - PROVIDER_RANK[b.result.provider] ||
        yearMatch(b.result) - yearMatch(a.result) ||
        have(b.result) - have(a.result) ||
        a.index - b.index,
    )
    .map((x) => x.result)
}

// Counts each enabled catalog's hits in a result set, one entry per provider (in the
// given order) even when its count is 0. Keying the source filter to the enabled
// providers rather than to what a search returned is what lets it stay put across
// searches instead of appearing only when a query happens to span two catalogs.
export function providerCountsOf(
  results: SearchResult[],
  providers: SearchProviderId[],
): { provider: SearchProviderId; count: number }[] {
  return providers.map((provider) => ({
    provider,
    count: results.filter((r) => r.provider === provider).length,
  }))
}

export interface ReleaseMetaPatch {
  coverUrl: string | undefined
  coverPath: string | undefined
  meta: TrackMetadata
}

// The writing credits for a track: its own first, then the release-wide ones.
// Release-level credits scoped to specific tracks ("tracks": "A1 to B2") are
// skipped rather than range-parsed — attributing them to every track would be
// wrong more often than dropping them.
const WRITING_ROLE = /written|composed/i
function composerOf(rel: Release, track: ReleaseTrack | undefined): string {
  const own = (track?.extraartists ?? []).filter((a) => WRITING_ROLE.test(a.role))
  if (own.length) return joinArtists(own)
  return joinArtists(
    (rel.extraartists ?? []).filter((a) => WRITING_ROLE.test(a.role) && !a.tracks?.trim()),
  )
}

// Applying a release overwrites the album-level data and the chosen track's
// title/number/artist, so the song ends up fully tagged from Discogs in one
// action. The cover is the exception: a file that already carries a cover keeps
// it (cover.keep) so the user's good art isn't replaced by Discogs' often-smaller
// image; only a missing or low-res cover is filled from the release. Either way
// the release's images stay reachable through the cover picker. Fields the release
// doesn't carry keep their current value.
export function buildReleaseMeta(
  current: TrackMetadata,
  rel: Release,
  track: ReleaseTrack | undefined,
  cover: { url?: string; path?: string; keep?: boolean } = {},
): ReleaseMetaPatch {
  const albumArtist = joinArtists(rel.artists)
  const genre = (rel.styles?.length ? rel.styles : (rel.genres ?? []))[0] ?? ''
  const trackArtist = joinArtists(track?.artists)
  const label = rel.labels?.[0]
  const publisher = label?.name?.trim() ?? ''
  const catno = label?.catno?.trim() ?? ''
  const catalogNumber = catno && catno.toLowerCase() !== 'none' ? catno : ''
  const pos = track ? splitPosition(track.position) : undefined
  const keepCover = cover.keep && !!cover.url
  return {
    coverUrl: keepCover ? cover.url : coverOf(rel, cover.url),
    coverPath: keepCover ? cover.path : undefined,
    meta: {
      ...current,
      title: track ? track.title : current.title,
      trackNumber: pos ? pos.track : current.trackNumber,
      discNumber: pos ? pos.disc : current.discNumber,
      album: rel.title,
      albumArtist,
      // Like every other field, the artist applies from the release: the track's own
      // artist (compilations) first, then the album artist — overwriting a wrong existing
      // value rather than keeping it. The current value stands only if Discogs has none.
      artist: trackArtist || albumArtist || current.artist,
      year: rel.year ? String(rel.year) : current.year,
      genre,
      publisher: publisher || current.publisher,
      catalogNumber: catalogNumber || current.catalogNumber,
      composer: composerOf(rel, track) || current.composer,
      // Provenance is Discogs-specific: a Bandcamp match must not stamp its id into the
      // Discogs field (it gates auto-match's "skip already-matched" and the release link),
      // so a non-Discogs apply leaves whatever was there untouched.
      discogsReleaseId: rel.provider === 'discogs' ? String(rel.id) : current.discogsReleaseId,
    },
  }
}
