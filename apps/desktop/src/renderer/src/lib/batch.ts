import type { TFunction } from 'i18next'
import { type AudioProcessing, processesAudio } from '../../../shared/audioProcessing'
import { READ_ONLY_PROGRAMS, type ReadOnlyProgram } from '../../../shared/djProgram'
import {
  batchKeepMp3,
  editsInPlace,
  formatMatchesInput,
  hasFormatEquivalent,
  resolveJobFormat,
} from '../../../shared/format'
import { OUTPUT_FORMATS } from '../../../shared/outputFormats'
import { fromReadOnlyProgram, isFrom } from '../../../shared/trackOrigin'
import type { CustomField, FormatSetting, OutputFormat } from '../../../shared/types'
import type { TrackItem } from '../types'
import type { AppleMusicIndex } from './appleMusicLibrary'
import { type Destination, fromDestination } from './destination'
import { isDialStale, isStale } from './dirty'
import { missingRequiredOf } from './fields'
import { selectionReplaceMode } from './replaceSelection'

// A track is convertible when it has not been processed yet (idle), a previous attempt
// failed (error), or it was edited after converting (stale — the file no longer matches the
// editor, e.g. a year filled in across the selection after a Discogs apply). A done track
// still in sync, or one mid-process, is skipped so "Convert all" never re-runs duplicate work.
function isConvertible(track: TrackItem): boolean {
  return track.status === 'idle' || track.status === 'error' || isStale(track) || isDialStale(track)
}

// Whether a batch may take the track at all: a convertible state, or any settled state
// when the run is a deliberate "convert again" over done tracks — the done menu's
// re-export ran the plain gate and converted nothing (06/11).
function inScope(track: TrackItem, again: boolean): boolean {
  return again ? track.status !== 'processing' : isConvertible(track)
}

// Whether a single track can be converted right now: a convertible state plus every required
// field filled. The same gate the convert button enforces, so the keyboard shortcut and
// command palette can't bypass it and trigger a process that only fails on missing tags.
export function canProcessTrack(
  track: TrackItem,
  requiredFields: string[],
  customFields: readonly CustomField[] = [],
  again = false,
): boolean {
  return (
    inScope(track, again) &&
    !fromReadOnlyProgram(track) &&
    missingRequiredOf(track, requiredFields, customFields).length === 0
  )
}

// The tracks "Convert all"/"Convert (N)" will actually process: convertible by state and
// with every required field filled. Gating on completeness here (not only status) keeps the
// count and the toolbar button's enabled state honest — it no longer offers a convert that
// would only error per track — matching the single-track button's gate. Incomplete tracks
// are left out (still flagged in the list), never attempted.
export function eligibleForBatch(
  tracks: TrackItem[],
  requiredFields: string[],
  customFields: readonly CustomField[] = [],
  again = false,
): string[] {
  return tracks
    .filter((t) => canProcessTrack(t, requiredFields, customFields, again))
    .map((t) => t.id)
}

export function leftOutForMissing(
  tracks: TrackItem[],
  requiredFields: string[],
  customFields: readonly CustomField[] = [],
  again = false,
): { count: number; fields: string[] } {
  const missing = new Set<string>()
  let count = 0
  for (const track of tracks) {
    if (!inScope(track, again) || fromReadOnlyProgram(track)) continue
    const fields = missingRequiredOf(track, requiredFields, customFields)
    if (fields.length === 0) continue
    count += 1
    for (const field of fields) missing.add(field)
  }
  return { count, fields: requiredFields.filter((f) => missing.has(f)) }
}

// What Convert does with a set of tracks, answered once for every entry point: the header
// button, the editor footer, ⌘⇧↵ / ⌘⏎ and the palette all read this, so no two of them can
// disagree over one selection (the header converted 10 of 12 while the footer refused
// all 12, 06/11). `ready` is what a click converts; the rest says why the others stay out.
// A selection that mixes replacing a library copy with adding has no honest subset, so it
// holds everything back; a single track is never mixed.
export type ConvertGate = {
  ready: TrackItem[]
  missing: { count: number; fields: string[] }
  mixed: boolean
} & Record<ReadOnlyProgram, number>

const LEFT_OUT_KEY: Record<ReadOnlyProgram, string> = {
  serato: 'header.leftOutSerato',
}

export function convertGate(
  tracks: TrackItem[],
  requiredFields: string[],
  customFields: readonly CustomField[] = [],
  libraryIndex: AppleMusicIndex | null = null,
  again = false,
): ConvertGate {
  const mixed = tracks.length > 1 && selectionReplaceMode(libraryIndex, tracks) === 'mixed'
  return {
    ready: mixed
      ? []
      : tracks.filter((t) => canProcessTrack(t, requiredFields, customFields, again)),
    missing: leftOutForMissing(tracks, requiredFields, customFields, again),
    ...(Object.fromEntries(
      READ_ONLY_PROGRAMS.map((p) => [
        p,
        tracks.filter((t) => inScope(t, again) && isFrom(t, p)).length,
      ]),
    ) as Record<ReadOnlyProgram, number>),
    mixed,
  }
}

// The words for what the gate keeps out, shared by the header's note and the editor's
// batch plan so the two never describe one selection differently.
export function leftOutNote(gate: Omit<ConvertGate, 'ready'>, tr: TFunction): string | null {
  if (gate.mixed) return tr('editor.mixedReplaceSelection')
  const notes = [
    gate.missing.count > 0
      ? tr('header.leftOutMissing', {
          count: gate.missing.count,
          fields: gate.missing.fields.map((key) => tr(`fields.${key}`)).join(', '),
        })
      : null,
    ...READ_ONLY_PROGRAMS.map((p) =>
      gate[p] > 0 ? tr(LEFT_OUT_KEY[p], { count: gate[p] }) : null,
    ),
  ].filter((note) => note !== null)
  return notes.length ? notes.join(' · ') : null
}

// The outcome of converting one track: it wrote a file, the user skipped it past a
// file conflict, or it errored. Skips are neither success nor failure, so they're
// counted on their own rather than folded into the failure tally.
export type BatchOutcome = 'converted' | 'skipped' | 'failed'

export interface BatchSummary {
  converted: number
  skipped: number
  failed: number
  // True when the user cancelled the run. 'skipped' alone cannot say so: it also covers
  // a track removed mid-run, one already converting, a format with no equivalent output,
  // and a declined file conflict — five causes collapsed into one number, which made a
  // cancelled batch read exactly like a run that finished normally.
  cancelled?: boolean
  // True when every track the run wrote only had its tags rewritten, so the summary can
  // say "updated" where "converted" would claim a re-encode that never happened.
  updatedOnly?: boolean
}

// Reduces a batch run (one outcome per track) to per-bucket counts, so the UI can
// report the result at a glance without lumping skips in with genuine failures.
export function summarizeBatch(results: BatchOutcome[]): BatchSummary {
  return {
    converted: results.filter((r) => r === 'converted').length,
    skipped: results.filter((r) => r === 'skipped').length,
    failed: results.filter((r) => r === 'failed').length,
  }
}

// What the editor's batch footer holds: the format shown, whether it was picked by hand or
// is only the Settings default, the destination when one was picked by hand, and the
// Settings the run falls back to. The same inputs processAll gets, so the footer can work
// out what the run will do instead of describing the open track.
export interface BatchPick {
  format: FormatSetting
  formatByHand: boolean
  destination?: Destination
  settings: {
    outputFormat: FormatSetting
    keepMp3Sources: boolean
    overwriteOriginal: boolean
    convertBesideOriginal: boolean
    addToAppleMusic: boolean
  }
}

interface TrackPlan {
  format: OutputFormat
  sameFormat: boolean
  overwrite: boolean
  beside: boolean
}

// One track of the batch resolved the way useTrackProcessing.processOne and main's
// processTrack resolve it, or null when the run skips the track. Kept beside the gate so
// the label and the count read one answer; the tests pin each rule against the run's.
function planOf(track: TrackItem, pick: BatchPick, audio: AudioProcessing): TrackPlan | null {
  const { settings } = pick
  if (pick.format === 'source' && !hasFormatEquivalent(track.inputPath)) return null
  const keep = batchKeepMp3(
    pick.formatByHand ? pick.format : undefined,
    settings.outputFormat,
    settings.keepMp3Sources,
  )
  const format = resolveJobFormat(
    pick.format,
    track.inputPath,
    'aiff',
    keep,
    track.fromAppleMusic,
    pick.formatByHand,
  )
  const facets = pick.destination ? fromDestination(pick.destination) : settings
  const overwrite = facets.overwriteOriginal
  const beside = facets.convertBesideOriginal && !overwrite
  if (keep && format !== pick.format && beside && !processesAudio(audio)) return null
  return {
    format,
    sameFormat: formatMatchesInput(format, track.inputPath),
    overwrite,
    beside,
  }
}

export function batchSkips(track: TrackItem, pick: BatchPick, audio: AudioProcessing): boolean {
  return planOf(track, pick, audio) === null
}

export function batchWritesTagsOnly(
  ready: TrackItem[],
  pick: BatchPick,
  audioOf: (track: TrackItem) => AudioProcessing,
): boolean {
  let written = 0
  for (const track of ready) {
    const audio = audioOf(track)
    const plan = planOf(track, pick, audio)
    if (plan === null) continue
    written += 1
    const inPlace = !plan.beside && editsInPlace(plan.format, track.inputPath, plan.overwrite)
    if (!inPlace || !plan.sameFormat || processesAudio(audio)) return false
  }
  return written > 0
}

// The formats the run writes, each once, read off the same plan the run follows: the
// button names a single format only when this holds exactly one.
export function batchFormats(
  ready: TrackItem[],
  pick: BatchPick,
  audioOf: (track: TrackItem) => AudioProcessing,
): OutputFormat[] {
  const formats = new Set<OutputFormat>()
  for (const track of ready) {
    const plan = planOf(track, pick, audioOf(track))
    if (plan) formats.add(plan.format)
  }
  return [...formats]
}

// A file's own format, .aif and .aiff alike; one no output format names keeps its extension,
// and a file without one (a dot in a folder name is not one) reads as ''.
function inputFormatOf(path: string): string {
  const known = OUTPUT_FORMATS.find((f) => formatMatchesInput(f, path))
  if (known) return known
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot).toLowerCase()
}

// "Same as source" is offered only where it differs from a real format, over files of more
// than one format, or while it is the format in use, so the pick in effect always shows.
export function offersSourceFormat(tracks: TrackItem[], format: FormatSetting): boolean {
  return format === 'source' || new Set(tracks.map((t) => inputFormatOf(t.inputPath))).size > 1
}

export function leavesListAfterBatch(track: TrackItem): boolean {
  return (
    track.status === 'done' &&
    (track.verification === undefined || track.verification.status === 'ok') &&
    track.musicStatus !== 'error' &&
    !isStale(track) &&
    !isDialStale(track)
  )
}
