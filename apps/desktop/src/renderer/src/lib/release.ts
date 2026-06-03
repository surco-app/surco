import type {
  DiscogsRelease,
  DiscogsSearchResult,
  DiscogsTrack,
  TrackMetadata,
} from '../../../shared/types'
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

// Mirrors Meta's "Match Tracks: Automatically": picks the tracklist entry whose
// title best matches the title parsed from the file name, so the right mix
// (e.g. "Beeper's Mix") is preselected instead of the user hunting for it.
export function bestTrack(tracks: DiscogsTrack[], title: string): DiscogsTrack | undefined {
  const target = normalize(title)
  if (!target) return undefined
  const targetWords = new Set(target.split(' '))
  let best: DiscogsTrack | undefined
  let bestScore = 0
  for (const t of tracks) {
    const nt = normalize(t.title)
    if (!nt) continue
    let score: number
    if (nt === target) score = 1000
    else if (target.includes(nt) || nt.includes(target))
      score = 500 + Math.min(nt.length, target.length)
    else score = nt.split(' ').filter((w) => targetWords.has(w)).length
    if (score > bestScore) {
      bestScore = score
      best = t
    }
  }
  return bestScore > 0 ? best : undefined
}

export interface ReleaseMetaPatch {
  coverUrl: string | undefined
  coverPath: undefined
  meta: TrackMetadata
}

// Applying a release overwrites the whole right-hand panel — album-level data
// and cover from the release, plus the chosen track's title/number/artist — so
// the song ends up fully tagged from Discogs in one action. Fields the release
// doesn't carry keep their current value.
export function buildReleaseMeta(
  current: TrackMetadata,
  rel: DiscogsRelease,
  track: DiscogsTrack | undefined,
  coverFallback?: string,
): ReleaseMetaPatch {
  const albumArtist = joinArtists(rel.artists)
  const genre = (rel.styles?.length ? rel.styles : (rel.genres ?? []))[0] ?? ''
  const trackArtist = joinArtists(track?.artists)
  const label = rel.labels?.[0]
  const publisher = label?.name?.trim() ?? ''
  const catno = label?.catno?.trim() ?? ''
  const catalogNumber = catno && catno.toLowerCase() !== 'none' ? catno : ''
  const pos = track ? splitPosition(track.position) : undefined
  return {
    coverUrl: coverOf(rel, coverFallback),
    coverPath: undefined,
    meta: {
      ...current,
      title: track ? track.title : current.title,
      trackNumber: pos ? pos.track : current.trackNumber,
      discNumber: pos ? pos.disc : current.discNumber,
      album: rel.title,
      albumArtist,
      artist: trackArtist || current.artist || albumArtist,
      year: rel.year ? String(rel.year) : current.year,
      genre,
      publisher: publisher || current.publisher,
      catalogNumber: catalogNumber || current.catalogNumber,
    },
  }
}
