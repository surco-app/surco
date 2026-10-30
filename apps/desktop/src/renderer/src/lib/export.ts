import type { DeclickConfig, NormalizeConfig, ProcessResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { parseFileName } from './filename'

// The track-state patch applied when an export finishes. After an in-place export
// the source file was rewritten — and possibly renamed — so the track must point
// at the new path; otherwise a later edit, re-export or playback would read the
// deleted original. A real conversion leaves the source alone, so the track keeps
// its inputPath/fileName and only records where the converted copy landed.
// `normalize` and `declick` are the configs the export applied, recorded so a later
// dial change flips the track stale (isNormalizeStale/isDeclickStale) and earns the
// Update button.
export function exportedPatch(
  track: TrackItem,
  result: ProcessResult,
  normalize?: NormalizeConfig,
  declick?: DeclickConfig,
): Partial<TrackItem> {
  // "Apple Music only": no file was kept in the output folder, so the track records no
  // outputPath and is flagged added — the editor then shows the Apple-Music confirmation
  // instead of a "Show file" that would point at nothing.
  if (result.addedToMusicOnly) {
    return {
      status: 'done',
      outputPath: undefined,
      musicStatus: 'added',
      ...(result.musicPersistentId && { musicPersistentId: result.musicPersistentId }),
      oldMusicCopyKept: result.oldMusicCopyKept,
      // The row was the file the replaced entry played, so it follows the entry to the
      // copy Music landed, as an in-place export follows its rewritten file.
      ...(result.musicLandedPath && {
        inputPath: result.musicLandedPath,
        fileName: parseFileName(result.musicLandedPath).fileName,
        movedFrom: [...(track.movedFrom ?? []), track.inputPath],
      }),
      ...(result.supersededPath && {
        supersededPath: result.supersededPath,
        supersededTrashed: undefined,
      }),
      stage: undefined,
      processedSignature: trackSignature(track),
      processedNormalize: normalize,
      processedDeclick: declick,
      // The staged state was just written out (here, into the Apple Music copy), so
      // nothing is at risk anymore: the session store stops persisting this track
      // and the reopen offer may expire freely again.
      diskSignature: trackSignature(track),
      cleaned: undefined,
    }
  }
  // An in-place export baked the staged trim into the rewritten source: the new
  // inputPath already starts at the cut. Left staged, the trim would re-cut the
  // already-cut file on the next Update — eating the start of the track — so it
  // is dropped. Only when a trim was actually staged — otherwise nothing shifted
  // and the field must stay untouched.
  const settledTrack = result.inPlace && track.trim ? { ...track, trim: undefined } : track
  return {
    status: 'done',
    outputPath: result.outputPath,
    outputIdentity: result.outputIdentity,
    ...(result.inPlace && {
      inputPath: result.outputPath,
      fileName: parseFileName(result.outputPath).fileName,
    }),
    ...(result.inPlace &&
      result.outputPath !== track.inputPath && {
        movedFrom: [...(track.movedFrom ?? []), track.inputPath],
      }),
    ...(settledTrack !== track && { trim: settledTrack.trim }),
    // The conversion's automatic Apple Music step already put the current metadata
    // in the library (add or sync), so the footer must show the added state rather
    // than offer an add that would duplicate the song. Conditional so a conversion
    // that skipped Apple Music never clobbers the ID a previous add stored.
    ...(result.musicPersistentId && {
      musicPersistentId: result.musicPersistentId,
      musicStatus: 'added' as const,
    }),
    // The conversion put this track in the Engine DJ library, so the membership badge
    // and filter read it owned without waiting for the library snapshot to refresh.
    ...(result.addedToEngineDj && { engineDjAdded: true }),
    oldMusicCopyKept: result.oldMusicCopyKept,
    // A format change replaced the Music entry, so its old file is now referenced by
    // nothing and is offered for trash like any other superseded copy.
    ...(result.supersededPath && {
      supersededPath: result.supersededPath,
      supersededTrashed: undefined,
    }),
    stage: undefined,
    processedSignature: trackSignature(settledTrack),
    processedNormalize: normalize,
    processedDeclick: declick,
    // The staged state now lives in the converted file, so nothing is at risk
    // anymore: the session store stops persisting this track and the reopen offer
    // may expire freely again.
    diskSignature: trackSignature(settledTrack),
    cleaned: undefined,
  }
}
