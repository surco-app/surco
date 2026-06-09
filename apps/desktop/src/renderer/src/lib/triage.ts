import type { TrackItem } from '../types'
import { qualityVerdict, type Verdict } from './quality'

// The per-track quality verdict surfaced as a row badge, so a whole dropped folder
// can be triaged at a glance instead of opening each track. 'unanalyzed' covers both
// "spectrum not measured yet" and "cutoff pass was inconclusive" — neither has a
// verdict to show, and both leave the row blank.
export type TrackQuality = Verdict | 'unanalyzed'

export function trackQuality(track: TrackItem): TrackQuality {
  const s = track.spectrum
  if (!s || s.cutoffHz === null) return 'unanalyzed'
  return qualityVerdict(s.cutoffHz, s.sampleRateHz)
}

// The tracks a "analyze quality" sweep should measure: those with no spectrum yet that
// aren't already being analyzed (by a hover prefetch or an earlier worker), so the run
// never double-spawns ffmpeg for the same file.
export function tracksToAnalyze(tracks: TrackItem[], inFlight: ReadonlySet<string>): TrackItem[] {
  return tracks.filter((t) => !t.spectrum && !inFlight.has(t.id))
}

// The list filter modes: everything, the suspect (likely fake-lossless) rips, the ones
// that passed as genuine lossless ('good'), the ones still without a verdict, or the ones
// not yet converted. 'unconverted' is a processing-status filter (status !== 'done'),
// orthogonal to the quality verdict.
export type QualityFilter =
  | 'all'
  | 'suspect'
  | 'good'
  | 'unanalyzed'
  | 'unconverted'
  | 'automatched'

export function filterByQuality(tracks: TrackItem[], filter: QualityFilter): TrackItem[] {
  if (filter === 'all') return tracks
  if (filter === 'unconverted') return tracks.filter((t) => t.status !== 'done')
  if (filter === 'automatched') return tracks.filter((t) => t.autoMatched)
  return tracks.filter((t) => trackQuality(t) === filter)
}

// Free-text list search, applied on top of the quality filter. Matches what the user
// can actually see or recognise the track by: the frozen list label and the source file
// name (both available before tags are read), plus the core artist/title/album tags, so
// typing a name narrows a big crate. Case-insensitive substring; a blank query keeps all.
export function matchesSearch(track: TrackItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [track.listLabel, track.fileName, track.meta?.title, track.meta?.artist, track.meta?.album]
    .filter((field): field is string => Boolean(field))
    .some((field) => field.toLowerCase().includes(q))
}

// Tallies for the filter chips, so the bar can show "5 suspect" without the caller
// walking the list per chip. 'unconverted' overlaps the quality buckets (it's a
// different dimension), so it's counted independently rather than as an else-branch.
export function qualityCounts(tracks: TrackItem[]): {
  suspect: number
  good: number
  unanalyzed: number
  unconverted: number
  automatched: number
} {
  let suspect = 0
  let good = 0
  let unanalyzed = 0
  let unconverted = 0
  let automatched = 0
  for (const t of tracks) {
    const q = trackQuality(t)
    if (q === 'suspect') suspect += 1
    else if (q === 'good') good += 1
    else unanalyzed += 1
    if (t.status !== 'done') unconverted += 1
    if (t.autoMatched) automatched += 1
  }
  return { suspect, good, unanalyzed, unconverted, automatched }
}
