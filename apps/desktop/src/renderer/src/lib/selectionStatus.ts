import type { TrackItem } from '../types'

// A stranded file and the track whose replacement stranded it, so trashing it marks
// that track and no other.
export interface SupersededFile {
  trackId: string
  path: string
}

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
  // The files a multi-select batch of replacements left stranded: out of Apple Music,
  // with rekordbox following their successors. Empty in single-select, where the footer
  // offers the one file through supersededFile instead.
  superseded: SupersededFile[]
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
  // The files a batch of replacements stranded: each one left Apple Music and rekordbox
  // now follows its successor, so nothing references them. Single-select has its own
  // per-track link (supersededFile), so this stays empty there and the two offers can
  // never both appear. Unfinished and already-trashed tracks drop out for the same reasons
  // supersededFile applies per track.
  const superseded = isMulti
    ? multiTracks
        .filter((t) => t.status === 'done' && t.replacesPath && !t.supersededTrashed)
        .map((t) => ({ trackId: t.id, path: t.replacesPath as string }))
    : []
  return {
    showDone,
    revealPath,
    inMusicLibraryOnly,
    canDeleteOriginal,
    musicAdding,
    musicAdded,
    musicError,
    superseded,
  }
}
