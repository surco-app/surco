import type { TrackItem } from '../types'

// The post-convert footer's aggregate view of the selection. In single-track mode the
// values mirror the one open track; in multi-select the done block shows once every
// selected track is converted, reveal opens the first output, and the Apple Music
// state reflects the whole selection.
export interface SelectionStatus {
  showDone: boolean
  revealPath: string | undefined
  inMusicLibraryOnly: boolean
  canDeleteOriginal: boolean
  musicAdding: boolean
  musicAdded: boolean
  musicError: string | undefined
}

export function selectionStatus(
  item: TrackItem,
  selectedTracks: TrackItem[] | undefined,
  // Whether the single open track counts as done (status 'done' and not edited since;
  // the staleness rule lives with the editor, which owns the convert button).
  done: boolean,
): SelectionStatus {
  const isMulti = (selectedTracks?.length ?? 0) > 1
  const multiTracks = selectedTracks ?? []
  const showDone = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.status === 'done')
    : done
  const revealPath = isMulti ? multiTracks.find((t) => t.outputPath)?.outputPath : item.outputPath
  // "Apple Music only": the conversion left no file in the output folder, so a finished
  // track carries no path to reveal — confirm the library add instead of a dead button.
  const inMusicLibraryOnly = showDone && !revealPath
  // A real conversion writes a separate file and leaves the source at its own path;
  // an in-place export rewrites the source, so inputPath === outputPath and there is
  // nothing distinct to trash. Single-track only, and gone once the original is trashed.
  const canDeleteOriginal =
    !isMulti && !!item.outputPath && item.outputPath !== item.inputPath && !item.originalTrashed
  const musicAdding = isMulti
    ? multiTracks.some((t) => t.musicStatus === 'adding')
    : item.musicStatus === 'adding'
  const musicAdded = isMulti
    ? multiTracks.length > 0 && multiTracks.every((t) => t.musicStatus === 'added')
    : item.musicStatus === 'added'
  const musicError = isMulti
    ? multiTracks.find((t) => t.musicStatus === 'error')?.musicError
    : item.musicError
  return {
    showDone,
    revealPath,
    inMusicLibraryOnly,
    canDeleteOriginal,
    musicAdding,
    musicAdded,
    musicError,
  }
}
