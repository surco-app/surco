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

// The list filter, split into independent dimensions so a DJ can stack one choice from
// each at once ("not in Apple Music" + "good" + "WAV" + "unconverted") instead of being
// forced to pick a single bucket. Each axis is nullable — null means "no constraint on
// this dimension" — and the active axes are ANDed together (see matchesFilter).
//
// Quality is the spectrum verdict: the suspect (likely fake-lossless) rips, the ones that
// passed as genuine lossless ('good'), or the ones still without a verdict ('unanalyzed').
export type QualityFilter = 'suspect' | 'good' | 'unanalyzed'
// Conversion/provenance: still pending conversion (status !== 'done') or filled by
// auto-match — a different dimension from the quality verdict, so its own axis.
export type ConversionFilter = 'unconverted' | 'automatched'
// The Apple Music library buckets, gated on a known verdict (see matchesLibrary).
export type LibraryFilter = 'inLibrary' | 'notInLibrary'
// The same song loaded as two files (see lib/duplicates); a single-value axis so it
// stacks with the others like any dimension.
export type DuplicatesFilter = 'duplicates'

// One selection per dimension, all combined with AND. `format` is the source container
// ('WAV', 'FLAC'…, see formatBuckets / sourceFormat); like the rest, null means "any".
export interface FilterSelection {
  quality: QualityFilter | null
  conversion: ConversionFilter | null
  library: LibraryFilter | null
  duplicates: DuplicatesFilter | null
  format: string | null
}

export const EMPTY_FILTER: FilterSelection = {
  quality: null,
  conversion: null,
  library: null,
  duplicates: null,
  format: null,
}

// The source container read straight off the input path's extension, uppercased (FLAC,
// MP3, WAV, AIFF). The parsed fileName has already dropped its extension, so the row pill,
// the per-format filter and the format sort all derive it here to stay in lockstep.
export function sourceFormat(track: TrackItem): string | undefined {
  return /\.([^./]+)$/.exec(track.inputPath)?.[1]?.toUpperCase()
}

// 'suspect' is the triage bucket for everything flagged, so it spans the amber (warn) and
// both red verdicts — plain low-bitrate (bad) and enhancer-faked (processed) — so one
// choice isolates all the dubious rips.
function matchesQuality(track: TrackItem, filter: QualityFilter): boolean {
  const q = trackQuality(track)
  if (filter === 'suspect') return q === 'warn' || q === 'bad' || q === 'processed'
  return q === filter
}

// The flagged rips out of a given set, for the one-click "trash the fakes" action. Reuses
// the suspect filter so the deletion targets exactly the rows the suspect bucket shows —
// never a genuine-lossless or still-unmeasured track.
export function suspectTracks(tracks: TrackItem[]): TrackItem[] {
  return tracks.filter((t) => matchesQuality(t, 'suspect'))
}

function matchesConversion(track: TrackItem, filter: ConversionFilter): boolean {
  if (filter === 'unconverted') return track.status !== 'done'
  return Boolean(track.autoMatched)
}

// The library buckets are gated on a known verdict: a track whose library status hasn't
// been resolved yet (undefined) belongs to neither, so it never shows under both "owned"
// and "missing".
function matchesLibrary(track: TrackItem, filter: LibraryFilter): boolean {
  return filter === 'inLibrary' ? track.inLibrary === true : track.inLibrary === false
}

// True when a track satisfies every active axis. Each null axis is skipped, so an empty
// selection matches everything and adding a constraint only ever narrows the result.
export function matchesFilter(track: TrackItem, sel: FilterSelection): boolean {
  if (sel.quality && !matchesQuality(track, sel.quality)) return false
  if (sel.conversion && !matchesConversion(track, sel.conversion)) return false
  if (sel.library && !matchesLibrary(track, sel.library)) return false
  if (sel.duplicates && track.duplicate !== true) return false
  if (sel.format && sourceFormat(track) !== sel.format) return false
  return true
}

// Filters the list, but keeps the library buckets sticky: once a row is shown while a
// library axis is active it stays in view even after a background auto-match rewrites its
// tags to the canonical name — which then matches the Apple Music library and would flip
// it out of the "missing" bucket — so the list never drops a row out from under the user
// while they work the match column. `sticky` carries the pinned IDs across renders and is
// extended in place with the rows matching now; the caller resets it (a fresh Set) when
// the selection changes, the deliberate "refresh" that recomputes membership from the live
// verdicts. With no library axis, the selection changes only by the user's own edits, so
// it ignores the set and follows the live verdicts exactly like matchesFilter. A pinned
// row must still satisfy the other axes — only the library flip is defeated — so a
// completed background analysis can still drop it from, say, the 'unanalyzed' bucket.
export function filterWithSticky(
  tracks: TrackItem[],
  sel: FilterSelection,
  sticky: Set<string>,
): TrackItem[] {
  const matching = tracks.filter((t) => matchesFilter(t, sel))
  if (!sel.library) return matching
  for (const t of matching) sticky.add(t.id)
  const exceptLibrary: FilterSelection = { ...sel, library: null }
  return tracks.filter((t) => sticky.has(t.id) && matchesFilter(t, exceptLibrary))
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
  duplicates: number
} {
  let suspect = 0
  let good = 0
  let unanalyzed = 0
  let unconverted = 0
  let automatched = 0
  let inLibrary = 0
  let notInLibrary = 0
  let duplicates = 0
  for (const t of tracks) {
    const q = trackQuality(t)
    if (q === 'warn' || q === 'bad' || q === 'processed') suspect += 1
    else if (q === 'good') good += 1
    else unanalyzed += 1
    if (t.status !== 'done') unconverted += 1
    if (t.autoMatched) automatched += 1
    if (t.inLibrary === true) inLibrary += 1
    else if (t.inLibrary === false) notInLibrary += 1
    if (t.duplicate) duplicates += 1
  }
  return {
    suspect,
    good,
    unanalyzed,
    unconverted,
    automatched,
    inLibrary,
    notInLibrary,
    duplicates,
  }
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
