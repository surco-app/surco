import type { DeclickMode, NormalizeConfig } from '../../../shared/types'
import type { TrackItem } from '../types'
import { isDeclickStale, isNormalizeStale } from './dirty'

// True once an in-place export rewrote the source and repointed the track at it
// (exportedPatch sets inputPath to outputPath): the file the next job would read is
// the one the filters were already baked into. A real conversion leaves inputPath on
// the untouched original, so its next export must apply everything from scratch.
function readsItsOwnExport(track: TrackItem): boolean {
  return (
    track.status === 'done' &&
    track.outputPath !== undefined &&
    track.inputPath === track.outputPath
  )
}

// The filters that alter samples are baked into an in-place export, so re-sending them
// on the next Update would run them a second time over audio that already has them —
// and force a re-encode where a metadata-only edit could have been a stream copy
// (planConversion's copyOk), costing a generation on lossy formats for nothing.
//
// The skip is expressed as an explicit 'none'/'off' rather than an absent config,
// because processTrack falls back to the Settings default when the job carries none —
// which would re-apply exactly the filter being skipped.
//
// A filter still goes out when the file doesn't already carry it: the export wrote a
// separate copy, or the user dialed something different (the stale checks), which is
// the deliberate re-apply that must keep working. Re-applying then measures the
// current file, so a new target lands on that target instead of stacking gain.

// Which normalization this track is actually converted with, before the skip below
// decides whether to re-send it. types.ts calls track.normalize "the normalization
// dialled for THIS track", and trim (the third filter, right beside it in the job) was
// always passed per track — but normalize and declick were taken from the batch pick
// alone, so converting a selection flattened every row onto whichever value the editor
// happened to hold last. A DJ who set one track to -18 and another to -7 got both at
// -7, and the same for a dusty rip dialled to `strong` next to a clean one at `off`.
//
// The order is the contract that comment states: the track's own dial wins, the caller's
// pick stands in for a track that has never been touched, and Settings is the floor
// processTrack itself falls back to. Kept here rather than at the call sites so the
// conversion and the warning that predicts it (hasActiveFilters) cannot drift apart.
//
// The fallback is deliberately optional, and the asymmetry between the two call sites in
// useTrackProcessing is not an oversight: the JOB omits it, because main applies
// `job.normalize ?? settings.normalize` itself (processTrack.ts) and sending the
// resolved value would erase the distinction between "the user picked this" and "nothing
// was picked". The RECORD passes it, because it has to describe what main actually ran,
// fallback included, or the stale checks compare against a conversion that never happened.
export function normalizeFor(
  track: TrackItem,
  pick: NormalizeConfig | undefined,
  fallback?: NormalizeConfig,
): NormalizeConfig | undefined {
  return track.normalize ?? pick ?? fallback
}

export function declickFor(
  track: TrackItem,
  pick: DeclickMode | undefined,
  fallback?: DeclickMode,
): DeclickMode | undefined {
  return track.declick ?? pick ?? fallback
}

export function normalizeForJob(
  track: TrackItem,
  current: NormalizeConfig | undefined,
): NormalizeConfig | undefined {
  const applied = track.processedNormalize
  if (!applied || applied.mode === 'none') return current
  if (!readsItsOwnExport(track)) return current
  if (current && isNormalizeStale(track, current)) return current
  return { ...applied, mode: 'none' }
}

export function declickForJob(
  track: TrackItem,
  current: DeclickMode | undefined,
): DeclickMode | undefined {
  const applied = track.processedDeclick
  if (!applied || applied === 'off') return current
  if (!readsItsOwnExport(track)) return current
  if (current && isDeclickStale(track, current)) return current
  return 'off'
}
