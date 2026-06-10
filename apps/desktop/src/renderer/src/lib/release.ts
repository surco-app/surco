import type {
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsTrack,
  TrackMetadata,
} from '../../../shared/types'
import { parseDuration } from './duration'
import { splitPosition } from './position'

export function cleanName(name: string): string {
  return name.replace(/\s*\(\d+\)$/, '')
}

export function joinArtists(artists?: { name: string }[]): string {
  return (artists ?? []).map((a) => cleanName(a.name)).join(', ')
}

export function coverOf(release: DiscogsRelease, fallback?: string): string | undefined {
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
export function resultFromRelease(rel: DiscogsRelease): DiscogsSearchResult {
  const albumArtist = joinArtists(rel.artists)
  return {
    id: rel.id,
    title: albumArtist ? `${albumArtist} - ${rel.title}` : rel.title,
    year: rel.year ? String(rel.year) : undefined,
    thumb: coverOf(rel),
    label: rel.labels?.map((l) => l.name),
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// What we know about the file, used to score each tracklist entry. Every field
// past the title is optional: a release may carry no track durations, and a file
// may have no track number or artist tag — a missing signal is simply not scored.
export interface TrackMatchTarget {
  title: string
  durationSec?: number
  trackNumber?: string
  artist?: string
}

export interface ScoredTrack {
  track: DiscogsTrack
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

function titleSimilarity(target: string, candidate: string): number {
  const a = normalize(target)
  const b = normalize(candidate)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.7
  const targetWords = a.split(' ')
  const candidateWords = new Set(b.split(' '))
  const shared = targetWords.filter((w) => candidateWords.has(w)).length
  return shared ? 0.6 * (shared / targetWords.length) : 0
}

function durationProximity(
  localSec: number,
  trackDuration: string | undefined,
): number | undefined {
  const trackSec = parseDuration(trackDuration)
  if (trackSec === undefined) return undefined
  const delta = Math.abs(localSec - trackSec)
  if (delta <= DURATION_EXACT_SEC) return 1
  if (delta >= DURATION_MISS_SEC) return 0
  return (DURATION_MISS_SEC - delta) / (DURATION_MISS_SEC - DURATION_EXACT_SEC)
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
  track: DiscogsTrack,
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
  tracks: DiscogsTrack[],
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
function composerOf(rel: DiscogsRelease, track: DiscogsTrack | undefined): string {
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
  rel: DiscogsRelease,
  track: DiscogsTrack | undefined,
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
      discogsReleaseId: String(rel.id),
    },
  }
}
