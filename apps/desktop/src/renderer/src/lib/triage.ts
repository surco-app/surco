import type { TrackItem } from '../types'
import { foldText } from './normalizeText'
import { qualityVerdict, type Verdict } from './quality'

// The per-track quality verdict surfaced as a row badge, so a whole dropped folder
// can be triaged at a glance instead of opening each track. 'unanalyzed' covers both
// "spectrum not measured yet" and "cutoff pass was inconclusive" — neither has a
// verdict to show, and both leave the row blank.
export type TrackQuality = Verdict | 'unanalyzed'

export function trackQuality(track: TrackItem): TrackQuality {
  const s = track.spectrum
  if (!s || s.cutoffHz === null) return 'unanalyzed'
  return qualityVerdict(s.cutoffHz, s.sampleRateHz, s.processed)
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
  // 'suspect' is the triage bucket for everything flagged, so it spans the amber
  // (warn) and both red verdicts — plain low-bitrate (bad) and enhancer-faked
  // (processed) — so one chip isolates all the dubious rips.
  if (filter === 'suspect')
    return tracks.filter((t) => {
      const q = trackQuality(t)
      return q === 'warn' || q === 'bad' || q === 'processed'
    })
  return tracks.filter((t) => trackQuality(t) === filter)
}

// Free-text list search, applied on top of the quality filter. Matches what the user
// can actually see or recognise the track by: the frozen list label and the source file
// name (both available before tags are read), plus the core artist/title/album tags, so
// typing a name narrows a big crate. Case-insensitive substring; a blank query keeps all.
export function matchesSearch(track: TrackItem, query: string): boolean {
  // Fold both sides so an accent-free query ("cancion") finds an accented title
  // ("canción") — the same canonical key the Discogs scorer compares on.
  const q = foldText(query)
  if (!q) return true
  return [track.listLabel, track.fileName, track.meta?.title, track.meta?.artist, track.meta?.album]
    .filter((field): field is string => Boolean(field))
    .some((field) => foldText(field).includes(q))
}

// The list sort modes: the drop order ('import'), or by name, artist or length.
export type TrackSort = 'import' | 'name' | 'artist' | 'duration'

// One shared collator instead of per-comparison localeCompare: the sort re-runs on
// every list-affecting render (each editor keystroke while a sort is active), and
// localeCompare re-creates the collation tables on every call.
const collator = new Intl.Collator()

// Orders the (already filtered) list for display. 'import' returns the list untouched so the
// drop order survives verbatim; the rest sort a copy. Array.sort is stable, so equal rows
// keep their import order and toggling sorts never scrambles ties. Untagged artists and
// unprobed durations sort to the end, where missing data is least in the way.
export function sortTracks(tracks: TrackItem[], sort: TrackSort): TrackItem[] {
  if (sort === 'import') return tracks
  return [...tracks].sort((a, b) => {
    if (sort === 'name') return collator.compare(a.listLabel, b.listLabel)
    if (sort === 'artist') {
      const aa = a.meta.artist || ''
      const bb = b.meta.artist || ''
      if (!aa || !bb) return (aa ? 0 : 1) - (bb ? 0 : 1)
      return collator.compare(aa, bb)
    }
    return (a.duration ?? Number.POSITIVE_INFINITY) - (b.duration ?? Number.POSITIVE_INFINITY)
  })
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
    if (q === 'warn' || q === 'bad' || q === 'processed') suspect += 1
    else if (q === 'good') good += 1
    else unanalyzed += 1
    if (t.status !== 'done') unconverted += 1
    if (t.autoMatched) automatched += 1
  }
  return { suspect, good, unanalyzed, unconverted, automatched }
}
