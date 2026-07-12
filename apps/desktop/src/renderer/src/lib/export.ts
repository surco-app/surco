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
      stage: undefined,
      processedSignature: trackSignature(track),
      processedNormalize: normalize,
    processedDeclick: declick,
      // The staged state was just written out (here, into the Apple Music copy), so
      // nothing is at risk anymore: the session store stops persisting this track
      // and the reopen offer may expire freely again.
      diskSignature: trackSignature(track),
    }
  }
  return {
    status: 'done',
    outputPath: result.outputPath,
    ...(result.inPlace && {
      inputPath: result.outputPath,
      fileName: parseFileName(result.outputPath).fileName,
    }),
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
    stage: undefined,
    processedSignature: trackSignature(track),
    processedNormalize: normalize,
    processedDeclick: declick,
    // The staged state now lives in the converted file, so nothing is at risk
    // anymore: the session store stops persisting this track and the reopen offer
    // may expire freely again.
    diskSignature: trackSignature(track),
  }
}
