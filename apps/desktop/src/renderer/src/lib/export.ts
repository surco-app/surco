import type { ProcessResult } from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'
import { parseFileName } from './filename'

// The track-state patch applied when an export finishes. After an in-place export
// the source file was rewritten — and possibly renamed — so the track must point
// at the new path; otherwise a later edit, re-export or playback would read the
// deleted original. A real conversion leaves the source alone, so the track keeps
// its inputPath/fileName and only records where the converted copy landed.
export function exportedPatch(track: TrackItem, result: ProcessResult): Partial<TrackItem> {
  return {
    status: 'done',
    outputPath: result.outputPath,
    ...(result.inPlace && {
      inputPath: result.outputPath,
      fileName: parseFileName(result.outputPath).fileName,
    }),
    stage: undefined,
    processedSignature: trackSignature(track),
  }
}
