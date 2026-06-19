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
  return qualityVerdict(s.cutoffHz, s.sampleRateHz, s.processed, s.hasKnee)
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
  | 'inLibrary'
  | 'notInLibrary'
  // Per-source-format buckets ('ext:MP3', 'ext:WAV'…), only offered for a mixed crate.
  // The fixed buckets above are quality/provenance dimensions; this one is the container.
  | `ext:${string}`

// The source container read straight off the input path's extension, uppercased (FLAC,
// MP3, WAV, AIFF). The parsed fileName has already dropped its extension, so the row pill,
// the per-format filter and the format sort all derive it here to stay in lockstep.
export function sourceFormat(track: TrackItem): string | undefined {
  return /\.([^./]+)$/.exec(track.inputPath)?.[1]?.toUpperCase()
}

export function filterByQuality(tracks: TrackItem[], filter: QualityFilter): TrackItem[] {
  if (filter === 'all') return tracks
  // Per-format bucket: 'ext:MP3' keeps only the tracks whose source container matches,
  // so a mixed crate can be worked one format at a time.
  if (filter.startsWith('ext:')) {
    const fmt = filter.slice(4)
    return tracks.filter((t) => sourceFormat(t) === fmt)
  }
  if (filter === 'unconverted') return tracks.filter((t) => t.status !== 'done')
  if (filter === 'automatched') return tracks.filter((t) => t.autoMatched)
  // The Apple Music library buckets are a third dimension, gated on a known verdict:
  // a track whose library status hasn't been resolved yet (undefined) belongs to
  // neither, so it never shows under both "owned" and "missing".
  if (filter === 'inLibrary') return tracks.filter((t) => t.inAppleMusic === true)
  if (filter === 'notInLibrary') return tracks.filter((t) => t.inAppleMusic === false)
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

// The two filters whose verdict can flip under the user without any action of theirs: a
// background auto-match rewrites a row's tags to the canonical name, which then matches
// the Apple Music library and moves the row between the "owned" and "missing" buckets.
const LIBRARY_FILTERS = new Set<QualityFilter>(['inLibrary', 'notInLibrary'])

// Filters the list, but keeps the library buckets sticky: once a row is shown under
// inLibrary/notInLibrary it stays in view even after a background auto-match flips its
// verdict, so the list never drops a row out from under the user while they work the
// match column. `sticky` carries the pinned IDs across renders and is extended in place
// with the rows matching now; the caller resets it (a fresh Set) when the filter changes,
// which is the deliberate "refresh" that recomputes membership from the live verdicts.
// Non-library filters change only by the user's own edits, so they ignore the set and
// follow the live verdict exactly like filterByQuality.
export function filterWithSticky(
  tracks: TrackItem[],
  filter: QualityFilter,
  sticky: Set<string>,
): TrackItem[] {
  const matching = filterByQuality(tracks, filter)
  if (!LIBRARY_FILTERS.has(filter)) return matching
  for (const t of matching) sticky.add(t.id)
  return tracks.filter((t) => sticky.has(t.id))
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

// The list sort modes: the drop order ('import'), or by name, artist, length or source
// format (which groups a mixed crate by container).
export type TrackSort = 'import' | 'name' | 'artist' | 'duration' | 'format'

// The sort direction. 'import' has none (it's the drop order), so the toggle is hidden
// there; every other mode flips between ascending and descending.
export type SortDir = 'asc' | 'desc'

// One shared collator instead of per-comparison localeCompare: the sort re-runs on
// every list-affecting render (each editor keystroke while a sort is active), and
// localeCompare re-creates the collation tables on every call.
const collator = new Intl.Collator()

// Compares two text keys, missing values last and direction-independent (see sortTracks).
// Only the present-vs-present comparison takes the sign, so empties never flip to the top.
function compareText(a: string | undefined, b: string | undefined, sign: number): number {
  const aa = a || ''
  const bb = b || ''
  if (!aa || !bb) return (aa ? 0 : 1) - (bb ? 0 : 1)
  return sign * collator.compare(aa, bb)
}

// Orders the (already filtered) list for display. 'import' returns the list untouched so the
// drop order survives verbatim; the rest sort a copy. Array.sort is stable, so equal rows
// keep their import order and toggling sorts never scrambles ties. Untagged artists,
// unprobed durations and extension-less paths sort to the end — and stay there in BOTH
// directions, since that missing data is noise to keep out of the way, not a value to flip
// to the top when the order reverses. So only the present-vs-present comparison takes the
// direction sign; the empty-last rule is applied direction-independently.
export function sortTracks(
  tracks: TrackItem[],
  sort: TrackSort,
  dir: SortDir = 'asc',
): TrackItem[] {
  if (sort === 'import') return tracks
  const sign = dir === 'desc' ? -1 : 1
  return [...tracks].sort((a, b) => {
    if (sort === 'name') return sign * collator.compare(a.listLabel, b.listLabel)
    if (sort === 'artist') return compareText(a.meta.artist, b.meta.artist, sign)
    if (sort === 'format') return compareText(sourceFormat(a), sourceFormat(b), sign)
    if (a.duration == null || b.duration == null)
      return (a.duration == null ? 1 : 0) - (b.duration == null ? 1 : 0)
    return sign * (a.duration - b.duration)
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
  inLibrary: number
  notInLibrary: number
} {
  let suspect = 0
  let good = 0
  let unanalyzed = 0
  let unconverted = 0
  let automatched = 0
  let inLibrary = 0
  let notInLibrary = 0
  for (const t of tracks) {
    const q = trackQuality(t)
    if (q === 'warn' || q === 'bad' || q === 'processed') suspect += 1
    else if (q === 'good') good += 1
    else unanalyzed += 1
    if (t.status !== 'done') unconverted += 1
    if (t.autoMatched) automatched += 1
    if (t.inAppleMusic === true) inLibrary += 1
    else if (t.inAppleMusic === false) notInLibrary += 1
  }
  return { suspect, good, unanalyzed, unconverted, automatched, inLibrary, notInLibrary }
}

// The distinct source formats present, each with its count, for the per-format filter
// chips. Returns nothing for a single-format crate (or an empty list): one format needs
// no filter, so the menu only grows the extra buckets once the crate is actually mixed.
// Sorted by format so the chips keep a stable order across re-imports.
export function formatBuckets(tracks: TrackItem[]): { format: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const t of tracks) {
    const fmt = sourceFormat(t)
    if (fmt) counts.set(fmt, (counts.get(fmt) ?? 0) + 1)
  }
  if (counts.size < 2) return []
  return [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => collator.compare(a.format, b.format))
}
