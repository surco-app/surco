import { fileNamePart } from '../../../shared/format'
import type { TrackItem } from '../types'
import { hasStagedEdits } from './sessionEdits'

// Whether the file on disk already holds everything the editor shows for this track, so a
// tags-only update would write nothing new: read from disk, no staged edit, no values a
// library filled in or a title the file lacks, and the name it would be saved under is
// the one it has. One track and a selection both ask this of each track, so the footer
// goes quiet on the same evidence either way. The format, destination and required tags
// are the editor's and are checked by the caller; the name the naming pattern gives the
// track comes in resolved.
export function fileHoldsTrack(track: TrackItem, defaultOutputName: string): boolean {
  return (
    track.status === 'idle' &&
    track.diskSignature !== undefined &&
    !hasStagedEdits(track) &&
    track.fillSignature !== track.diskSignature &&
    !(track.notInFile?.signature === track.diskSignature && track.notInFile.fields.length > 0) &&
    fileNamePart(track.outputName?.trim() || defaultOutputName) === track.fileName
  )
}
