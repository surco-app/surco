// Accumulates the repoints a conversion run produces, so a batch of 300 tracks writes
// the collection once instead of 300 times — one backup, one open, one decision about
// whether rekordbox is running. Mirrors nmlBatch.ts, whose shape was already paid for on
// the Traktor side.

export interface RekordboxRepoint {
  from: string
  to: string
  meta?: RekordboxMeta
  // The conversion rewrote the audio: rekordbox's analysis describes the old file, and its
  // cues land back on the beats they were set on once moved by cueShiftMs.
  audio?: { cueShiftMs: number }
  // The same move as Engine DJ counts it (see shiftEnginePerformance).
  engineShift?: EngineShift
  // The source's size before a conversion rewrote it in place (see EngineRepoint).
  fromBytes?: number
  names?: Partial<Record<'title' | 'artist' | 'album' | 'genre', TagChange>>
  // A damage repair's guard and length fix (see EngineRepoint).
  expectTrackData?: { sampleRate: number; sampleCount: number }
  fixLength?: boolean
  playlists?: RekordboxPlaylistTarget[]
  playlistsBase?: string[]
  traktorPlaylists?: LibraryPlaylistChoice
  enginePlaylists?: LibraryPlaylistChoice
}

import type { WritableProgram } from '../shared/djProgram'
import type { LibraryPlaylistChoice, RekordboxPlaylistTarget, TagChange } from '../shared/types'
import type { EngineShift } from './engineRepoint'
import type { RekordboxMeta } from './rekordboxMetadata'

let repoints: RekordboxRepoint[] = []

// The renderer's begin/end calls are not guaranteed to nest cleanly: a whole-library run
// opens one pair around everything, while converting a single track opens its own, and
// nothing stops the second happening inside the first. So the accumulator owns
// correctness rather than trusting its callers — it resets only on the outermost begin
// and hands the pool back only on the outermost end.
let depth = 0

export function recordRekordboxRepoint(repoint: RekordboxRepoint): void {
  // A conversion that lands on the path it started from tells rekordbox nothing new, and
  // recording it would make the flush open and back up the collection for nothing.
  if (repoint.from === repoint.to && !repoint.meta && !repoint.audio) return
  // Converting one track twice in a run — a retry, an edit followed by a convert — must
  // leave the collection on the last file produced, so the later repoint replaces the
  // earlier one rather than queueing behind it.
  const existing = repoints.findIndex((r) => r.from === repoint.from)
  if (existing === -1) {
    repoints.push(repoint)
    return
  }
  repoints[existing] = stackRepoint(repoints[existing], repoint)
}

const sameTrackData = (
  a: RekordboxRepoint['expectTrackData'],
  b: NonNullable<RekordboxRepoint['expectTrackData']>,
): boolean => a?.sampleRate === b.sampleRate && a.sampleCount === b.sampleCount

// A later conversion of a file whose repoint is still waiting. Only a second conversion of
// the first one's output stacks its move on top; one that read the original again already
// measured from the file the cues were set on.
function stackNames(
  earlier: RekordboxRepoint['names'],
  later: RekordboxRepoint['names'],
): NonNullable<RekordboxRepoint['names']> {
  const out: NonNullable<RekordboxRepoint['names']> = { ...earlier }
  for (const [field, change] of Object.entries(later ?? {}) as [
    keyof NonNullable<RekordboxRepoint['names']>,
    TagChange,
  ][])
    out[field] = { from: earlier?.[field]?.from ?? change.from, to: change.to }
  return out
}

export function stackRepoint(
  earlier: RekordboxRepoint,
  repoint: RekordboxRepoint,
): RekordboxRepoint {
  if (repoint.expectTrackData && sameTrackData(earlier.expectTrackData, repoint.expectTrackData))
    return repoint
  const stacks = earlier.to === repoint.from
  const engineShift =
    stacks && earlier.engineShift
      ? {
          ...earlier.engineShift,
          ...repoint.engineShift,
          trimmedMs: earlier.engineShift.trimmedMs + (repoint.engineShift?.trimmedMs ?? 0),
        }
      : repoint.engineShift
  return {
    ...(earlier.audio && repoint.audio && stacks
      ? { ...repoint, audio: { cueShiftMs: earlier.audio.cueShiftMs + repoint.audio.cueShiftMs } }
      : repoint),
    ...(engineShift ? { engineShift } : {}),
    ...(stacks && earlier.fromBytes !== undefined ? { fromBytes: earlier.fromBytes } : {}),
    ...(earlier.expectTrackData && !repoint.expectTrackData
      ? { expectTrackData: earlier.expectTrackData }
      : {}),
    ...(earlier.fixLength ? { fixLength: true } : {}),
    ...(earlier.names || repoint.names ? { names: stackNames(earlier.names, repoint.names) } : {}),
  }
}

// Moves a recorded repoint onto the path the file really ended up at, keyed by the path
// the entry currently names.
//
// The Apple Music destination writes the conversion to a private temp dir and lets Music
// copy it into its Media folder, so the path known at conversion time is gone by the time
// the flush runs. Measured from the user's log 15/09: the flush refused with
// output-missing on a /var/folders/…/surco-… path, leaving the collection on the old MP3
// while the app reported success. Only the caller that hands the file to Music learns
// where it landed, so it corrects the entry here rather than the conversion guessing.
//
// A path the batch never recorded changes nothing: inventing an entry would repoint a
// track on the strength of an unrelated path. Landing back on the source drops the entry,
// the same "nothing moved" rule recordRekordboxRepoint applies.
export function redirectRekordboxRepoint(currentTo: string, landedAt: string): void {
  const index = repoints.findIndex((r) => r.to === currentTo)
  if (index === -1) return
  if (repoints[index].from === landedAt && !repoints[index].meta && !repoints[index].audio) {
    repoints.splice(index, 1)
    return
  }
  repoints[index] = { ...repoints[index], to: landedAt }
}

export function foldRekordboxBatch(): boolean {
  if (depth === 0) return false
  depth = 1
  return true
}

export function rekordboxBatchOpen(): boolean {
  return depth > 0
}

export function beginRekordboxBatch(): boolean {
  const opens = depth === 0
  if (opens) repoints = []
  depth += 1
  return opens
}

// Returns the accumulated repoints once the outermost batch closes; an inner end returns
// empty and leaves the pool for the outer end, so nothing is lost or flushed early.
export function endRekordboxBatch(): RekordboxRepoint[] {
  depth = Math.max(0, depth - 1)
  if (depth > 0) return []
  const result = repoints
  repoints = []
  return result
}

// The repoint the batch holds for a converted file, by where it landed: the last one, like
// recordedNmlPatch.
export function recordedRekordboxRepoint(to: string): RekordboxRepoint | undefined {
  return repoints.findLast((r) => r.to === to)
}

export interface PlaylistChoice {
  wanted: RekordboxPlaylistTarget[]
  base?: string[]
}

export const REPOINT_PLAYLISTS: Record<
  WritableProgram,
  (r: RekordboxRepoint) => PlaylistChoice | undefined
> = {
  rekordbox: (r) => (r.playlists ? { wanted: r.playlists, base: r.playlistsBase } : undefined),
  traktor: (r) => r.traktorPlaylists,
  engine: (r) => r.enginePlaylists,
}

const ATTACH_PLAYLISTS: Record<
  WritableProgram,
  (repoint: RekordboxRepoint, choice: PlaylistChoice) => RekordboxRepoint
> = {
  rekordbox: (repoint, { wanted, base }) => ({
    ...repoint,
    playlists: wanted,
    ...(base ? { playlistsBase: base } : {}),
  }),
  traktor: (repoint, { wanted, base }) => ({
    ...repoint,
    traktorPlaylists: { wanted, base: base ?? [] },
  }),
  engine: (repoint, { wanted, base }) => ({
    ...repoint,
    enginePlaylists: { wanted, base: base ?? [] },
  }),
}

export function attachPlaylists(
  to: string,
  program: WritableProgram,
  choice: PlaylistChoice,
): void {
  const index = repoints.findIndex((r) => r.to === to)
  if (index !== -1) repoints[index] = ATTACH_PLAYLISTS[program](repoints[index], choice)
}
