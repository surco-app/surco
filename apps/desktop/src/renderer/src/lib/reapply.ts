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
