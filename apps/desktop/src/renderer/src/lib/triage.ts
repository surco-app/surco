import type { TrackItem } from '../types'
import { foldText } from './normalizeText'
import { gradedExt, isLowResCover, isTranscode, qualityVerdict, type Verdict } from './quality'

// The per-track quality verdict surfaced as a row badge, so a whole dropped folder
// can be triaged at a glance instead of opening each track. 'unanalyzed' covers both
// "spectrum not measured yet" and "cutoff pass was inconclusive" — neither has a
// verdict to show, and both leave the row blank. 'transcoded' is a fake-lossless: a
// lossy cut hidden in a lossless container — the editor's headline verdict, promoted
// to the row so the deception is spottable without opening the track.
export type TrackQuality = Verdict | 'unanalyzed' | 'transcoded' | 'damaged'

export function trackQuality(track: TrackItem): TrackQuality {
  const s = track.spectrum
  if (s?.damaged) return 'damaged'
  if (!s || s.cutoffHz === null) return 'unanalyzed'
  // Transcode outranks the plain 'bad' grade the same way it does in the editor: a codec
  // knee in a .flac/.wav/.aiff means the file lies about its format, which is the headline.
  // Needs the extension, so it reads inputPath — the spectrum alone can't tell the container.
  const ext = gradedExt(track.inputPath ?? '', s.codec)
  if (isTranscode(ext, s.cutoffHz, s.hasKnee, s.processed)) return 'transcoded'
  return qualityVerdict(s.cutoffHz, s.sampleRateHz, s.processed, s.hasKnee, ext)
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
// Conversion/provenance: still pending conversion (status !== 'done'), filled by
// auto-match, or matched from a specific catalog — a different dimension from the
// quality verdict, so its own axis. The per-provider buckets let a mixed-crate sweep
// be reviewed source by source: a Bandcamp match carries no Discogs id or catalog
// number, so those rows are the ones worth a separate eyeball. By the same argument
// 'matchReview' and 'failed' get their own buckets: they are the rows the user still has
// to ACT on — the sweep's unapplied suggestions and the conversions that errored — and
// the toolbar already counts both, a count that until now pointed nowhere.
export type ConversionFilter =
  | 'unsaved'
  | 'unconverted'
  | 'failed'
  | 'automatched'
  | 'matchReview'
  | 'matchedDiscogs'
  | 'matchedBandcamp'
// The Apple Music library buckets, gated on a known verdict (see matchesLibrary).
export type LibraryFilter = 'inLibrary' | 'notInLibrary'
// The same song loaded as two files (see lib/duplicates); a single-value axis so it
// stacks with the others like any dimension.
export type DuplicatesFilter = 'duplicates'
// The retouch buckets djotas asked for: tracks whose decoded wave shows work left to
// do — lead-in/run-out silence not yet staged for trimming, or true digital clipping.
// Both read the audioIssues facts the view merges from the shared waveform cache, so
// a track with no wave decoded yet belongs to neither (like 'unanalyzed'). 'noCues' is the
// marking left to do: a DJ library row whose cues came back empty. A loose file has no
// library to read cues from, so it never lands there.
// 'unanalysedRekordbox' and 'unanalysedEngine' are the rows that program has not analysed
// yet, read the way the row's own mark reads them (see unanalysedIn).
export type AttentionFilter =
  | 'silence'
  | 'clipping'
  | 'noCues'
  | 'unanalysedRekordbox'
  | 'unanalysedEngine'
// The tag work matching a release fixes: no artwork, artwork too small for a CDJ screen
// (the editor's own low-res rule), no tempo, no key. A row still being read has no tags
// yet, so it belongs to none of them.
// 'missingRequired' is the Settings rule that keeps Convert all off a track, asked of App
// through FilterFacts like 'unsaved'.
export type TagsFilter = 'missingRequired' | 'noCover' | 'smallCover' | 'noBpm' | 'noKey'

// What the list knows about a row that the row itself does not carry: which fields
// Settings require, and the cue drafts the cue editor holds. App answers; the filter asks.
export interface FilterFacts {
  incomplete: (track: TrackItem) => boolean
  unsaved: (track: TrackItem) => boolean
}

export const NO_FACTS: FilterFacts = { incomplete: () => false, unsaved: () => false }

// One selection per dimension, all combined with AND. `format` is the source container
// ('WAV', 'FLAC'…, see formatBuckets / sourceFormat); like the rest, null means "any".
export interface FilterSelection {
  quality: QualityFilter | null
  conversion: ConversionFilter | null
  library: LibraryFilter | null
  duplicates: DuplicatesFilter | null
  attention: AttentionFilter | null
  tags: TagsFilter | null
  format: string | null
}

export const EMPTY_FILTER: FilterSelection = {
  quality: null,
  conversion: null,
  attention: null,
  tags: null,
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
  if (filter === 'suspect')
    return q === 'warn' || q === 'bad' || q === 'processed' || q === 'transcoded'
  return q === filter
}

// The flagged rips out of a given set, for the one-click "trash the fakes" action. Reuses
// the suspect filter so the deletion targets exactly the rows the suspect bucket shows —
// never a genuine-lossless or still-unmeasured track.
export function suspectTracks(tracks: TrackItem[]): TrackItem[] {
  return tracks.filter((t) => matchesQuality(t, 'suspect'))
}

// Narrower than 'unconverted' on purpose: that one means "not done", which covers every
// track never attempted. This one is only what was tried and broke: a conversion, the read
// of its tags, or the quality analysis.
function hasFailed(track: TrackItem): boolean {
  return track.status === 'error' || Boolean(track.metaReadFailed || track.analyzeFailed)
}

function matchesConversion(
  track: TrackItem,
  filter: ConversionFilter,
  facts: FilterFacts,
): boolean {
  if (filter === 'unsaved') return facts.unsaved(track)
  if (filter === 'unconverted') return track.status !== 'done'
  if (filter === 'failed') return hasFailed(track)
  if (filter === 'matchReview') return Boolean(track.matchReview)
  if (filter === 'matchedDiscogs') return track.matchProvider === 'discogs'
  if (filter === 'matchedBandcamp') return track.matchProvider === 'bandcamp'
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
export function matchesFilter(
  track: TrackItem,
  sel: FilterSelection,
  facts: FilterFacts = NO_FACTS,
): boolean {
  if (sel.quality && !matchesQuality(track, sel.quality)) return false
  if (sel.conversion && !matchesConversion(track, sel.conversion, facts)) return false
  if (sel.library && !matchesLibrary(track, sel.library)) return false
  if (sel.duplicates && track.duplicate !== true) return false
  if (sel.attention === 'silence' && track.audioIssues?.silence !== true) return false
  if (sel.attention === 'clipping' && track.audioIssues?.clipping !== true) return false
  if (sel.attention === 'noCues' && !hasNoCues(track)) return false
  if (sel.attention === 'unanalysedRekordbox' && unanalysedIn(track) !== 'rekordbox') return false
  if (sel.attention === 'unanalysedEngine' && unanalysedIn(track) !== 'engine') return false
  if (sel.tags && !matchesTags(track, sel.tags, facts)) return false
  if (sel.format && sourceFormat(track) !== sel.format) return false
  return true
}

function hasNoCues(track: TrackItem): boolean {
  return track.sourcePreview?.cues.length === 0
}

function matchesTags(track: TrackItem, filter: TagsFilter, facts: FilterFacts): boolean {
  if (track.loadingMeta) return false
  if (filter === 'missingRequired') return facts.incomplete(track)
  if (filter === 'noCover') return !track.coverUrl && !track.sourcePreview?.coverUrl
  if (filter === 'smallCover') {
    const original = Boolean(track.coverUrl) && track.coverUrl === track.embeddedCover
    const dims = track.embeddedCoverDims
    return original && dims !== undefined && isLowResCover(dims.w, dims.h)
  }
  if (filter === 'noBpm') return !track.meta?.bpm?.trim()
  return !track.meta?.key?.trim()
}

// The DJ program still to analyse this row. rekordbox ships no wave file for a track it has
// not analysed; Engine DJ says so in the row it reads. Traktor's rows carry neither.
export function unanalysedIn(track: TrackItem): 'rekordbox' | 'engine' | undefined {
  if (track.fromRekordbox && track.sourcePreview && !track.sourcePreview.analysisPath)
    return 'rekordbox'
  if (track.fromEngine && track.sourcePreview?.unanalysed) return 'engine'
  return undefined
}

// Read off EMPTY_FILTER's keys rather than a hand-kept list, so an axis added to the
// selection can never be left out of the key and leave the last filter's rows pinned.
export function filterSessionKey(sel: FilterSelection): string {
  return (Object.keys(EMPTY_FILTER) as (keyof FilterSelection)[])
    .map((axis) => sel[axis] ?? '')
    .join('|')
}

// Filters the list, but keeps every row it has shown in place for the rest of the filter
// session: a row whose verdict flips while the user works the list (an accepted review
// suggestion, a background auto-match that lands it in the library, an analysis that
// finishes under 'unanalyzed', a conversion under 'unconverted') stays put instead of
// vanishing and sliding the next row under the pointer. `sticky` carries the shown IDs
// across renders and is extended in place with the rows matching now, so a row that newly
// qualifies still appears. The caller resets it (a fresh Set) when the filter changes,
// the deliberate "refresh" that recomputes membership from the live verdicts.
export function filterWithSticky(
  tracks: TrackItem[],
  sel: FilterSelection,
  sticky: Set<string>,
  facts: FilterFacts = NO_FACTS,
): TrackItem[] {
  for (const t of tracks) if (matchesFilter(t, sel, facts)) sticky.add(t.id)
  return tracks.filter((t) => sticky.has(t.id))
}

// The rows on screen that the live filter no longer matches: the ones filterWithSticky
// kept in place after their verdict flipped, dimmed so they read as already handled.
export function outsideFilter(
  tracks: TrackItem[],
  sel: FilterSelection,
  facts: FilterFacts = NO_FACTS,
): Set<string> {
  return new Set(tracks.filter((t) => !matchesFilter(t, sel, facts)).map((t) => t.id))
}

// The fresh rows laid out in the order the list already shows, so a sort that would move
// a row under the user waits. Falls back to the fresh order whenever the set of rows
// changed (an import, a removal, a row the search no longer matches).
export function holdOrder<T extends { id: string | number }>(
  shown: T[],
  fresh: T[],
  keyOf: (t: T) => string = (t) => String(t.id),
): T[] {
  if (shown.length !== fresh.length) return fresh
  const byKey = new Map(fresh.map((t) => [keyOf(t), t]))
  const held: T[] = []
  for (const t of shown) {
    const live = byKey.get(keyOf(t))
    if (!live) return fresh
    held.push(live)
  }
  return held
}

// Free-text list search, applied on top of the quality filter. Matches what the user
// can actually see or recognise the track by: the frozen list label and the source file
// name (both available before tags are read), plus the core artist/title/album tags, so
// typing a name narrows a big crate. Case-insensitive substring; a blank query keeps all.
export function matchesSearch(track: TrackItem, query: string): boolean {
  return searchMatcher(query)(track)
}

// Each track's folded search fields, kept for as long as the track object is: the list's
// views keep their identity while a track is unchanged, so a keystroke folds the query and
// nothing else.
const foldedFields = new WeakMap<TrackItem, string[]>()

function searchFields(track: TrackItem): string[] {
  let fields = foldedFields.get(track)
  if (!fields) {
    fields = [
      track.listLabel,
      track.fileName,
      track.meta?.title,
      track.meta?.artist,
      track.meta?.album,
    ]
      .filter((field): field is string => Boolean(field))
      .map(foldText)
    foldedFields.set(track, fields)
  }
  return fields
}

// The search as a filter predicate, with the query folded once for the whole list.
export function searchMatcher(query: string): (track: TrackItem) => boolean {
  // Fold both sides so an accent-free query ("cancion") finds an accented title
  // ("canción") — the same canonical key the Discogs scorer compares on.
  const q = foldText(query)
  if (!q) return () => true
  return (track) => searchFields(track).some((field) => field.includes(q))
}

// The list sort modes: the drop order ('import'), or by name, artist, length, source
// format (which groups a mixed crate by container) or album order (disc, then track).
export type TrackSort = 'import' | 'name' | 'artist' | 'duration' | 'format' | 'trackNumber'

// The sort direction. 'import' has none (it's the drop order), so the toggle is hidden
// there; every other mode flips between ascending and descending.
export type SortDir = 'asc' | 'desc'

// One shared collator instead of per-comparison localeCompare: the sort re-runs on
// every list-affecting render (each editor keystroke while a sort is active), and
// localeCompare re-creates the collation tables on every call.
const collator = new Intl.Collator()
// Track and disc numbers compare by value ("9" before "10"), and a "/12" total after the
// number never decides anything once the numbers differ.
const numericCollator = new Intl.Collator(undefined, { numeric: true })

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
    if (sort === 'trackNumber') {
      if (!a.meta.trackNumber || !b.meta.trackNumber)
        return (a.meta.trackNumber ? 0 : 1) - (b.meta.trackNumber ? 0 : 1)
      return (
        sign *
        (numericCollator.compare(a.meta.discNumber ?? '', b.meta.discNumber ?? '') ||
          numericCollator.compare(a.meta.trackNumber, b.meta.trackNumber))
      )
    }
    if (a.duration == null || b.duration == null)
      return (a.duration == null ? 1 : 0) - (b.duration == null ? 1 : 0)
    return sign * (a.duration - b.duration)
  })
}

// Tallies for the filter chips, so the bar can show "5 suspect" without the caller
// walking the list per chip. 'unconverted' overlaps the quality buckets (it's a
// different dimension), so it's counted independently rather than as an else-branch.
export function qualityCounts(
  tracks: TrackItem[],
  facts: FilterFacts = NO_FACTS,
): {
  suspect: number
  good: number
  unanalyzed: number
  unconverted: number
  failed: number
  automatched: number
  matchReview: number
  matchedDiscogs: number
  matchedBandcamp: number
  inLibrary: number
  notInLibrary: number
  duplicates: number
  silence: number
  clipping: number
  noCues: number
  unanalysedRekordbox: number
  unanalysedEngine: number
  noCover: number
  smallCover: number
  noBpm: number
  noKey: number
  missingRequired: number
  unsaved: number
} {
  let suspect = 0
  let good = 0
  let unanalyzed = 0
  let unconverted = 0
  let failed = 0
  let automatched = 0
  let matchReview = 0
  let matchedDiscogs = 0
  let matchedBandcamp = 0
  let inLibrary = 0
  let notInLibrary = 0
  let duplicates = 0
  let silence = 0
  let clipping = 0
  let noCues = 0
  let unanalysedRekordbox = 0
  let unanalysedEngine = 0
  let noCover = 0
  let smallCover = 0
  let noBpm = 0
  let noKey = 0
  let missingRequired = 0
  let unsaved = 0
  for (const t of tracks) {
    const q = trackQuality(t)
    if (q === 'warn' || q === 'bad' || q === 'processed' || q === 'transcoded') suspect += 1
    else if (q === 'good') good += 1
    else if (q === 'unanalyzed') unanalyzed += 1
    if (t.status !== 'done') unconverted += 1
    if (hasFailed(t)) failed += 1
    if (t.autoMatched) automatched += 1
    if (t.matchReview) matchReview += 1
    if (t.matchProvider === 'discogs') matchedDiscogs += 1
    else if (t.matchProvider === 'bandcamp') matchedBandcamp += 1
    if (t.inLibrary === true) inLibrary += 1
    else if (t.inLibrary === false) notInLibrary += 1
    if (t.duplicate) duplicates += 1
    if (t.audioIssues?.silence) silence += 1
    if (t.audioIssues?.clipping) clipping += 1
    if (hasNoCues(t)) noCues += 1
    const waitingOn = unanalysedIn(t)
    if (waitingOn === 'rekordbox') unanalysedRekordbox += 1
    else if (waitingOn === 'engine') unanalysedEngine += 1
    if (matchesTags(t, 'noCover', facts)) noCover += 1
    if (matchesTags(t, 'smallCover', facts)) smallCover += 1
    if (matchesTags(t, 'noBpm', facts)) noBpm += 1
    if (matchesTags(t, 'noKey', facts)) noKey += 1
    if (matchesTags(t, 'missingRequired', facts)) missingRequired += 1
    if (facts.unsaved(t)) unsaved += 1
  }
  return {
    suspect,
    good,
    unanalyzed,
    unconverted,
    failed,
    automatched,
    matchReview,
    matchedDiscogs,
    matchedBandcamp,
    inLibrary,
    notInLibrary,
    duplicates,
    silence,
    clipping,
    noCues,
    unanalysedRekordbox,
    unanalysedEngine,
    noCover,
    smallCover,
    noBpm,
    noKey,
    missingRequired,
    unsaved,
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
