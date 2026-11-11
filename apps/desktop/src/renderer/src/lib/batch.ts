import type { TFunction } from 'i18next'
import { isFrom } from '../../../shared/trackOrigin'
import type { CustomField } from '../../../shared/types'
import type { TrackItem } from '../types'
import type { AppleMusicIndex } from './appleMusicLibrary'
import { isStale } from './dirty'
import { missingRequiredOf } from './fields'
import { selectionReplaceMode } from './replaceSelection'

// A track is convertible when it has not been processed yet (idle), a previous attempt
// failed (error), or it was edited after converting (stale — the file no longer matches the
// editor, e.g. a year filled in across the selection after a Discogs apply). A done track
// still in sync, or one mid-process, is skipped so "Convert all" never re-runs duplicate work.
function isConvertible(track: TrackItem): boolean {
  return track.status === 'idle' || track.status === 'error' || isStale(track)
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
    !isFrom(track, 'serato') &&
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
    if (!inScope(track, again) || isFrom(track, 'serato')) continue
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
export interface ConvertGate {
  ready: TrackItem[]
  missing: { count: number; fields: string[] }
  serato: number
  mixed: boolean
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
    serato: tracks.filter((t) => inScope(t, again) && isFrom(t, 'serato')).length,
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
    gate.serato > 0 ? tr('header.leftOutSerato', { count: gate.serato }) : null,
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
