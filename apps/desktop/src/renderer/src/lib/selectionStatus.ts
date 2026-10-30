import { PLACE_ORDER, type VerifyPlace } from '../../../shared/verification'
import type { TrackItem } from '../types'
import { supersededFile } from './supersededFile'

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
// What a multi-select batch's re-read found, one bucket per track, for the line that counts
// checked tracks instead of sent ones. `unverified` are the tracks never re-read; the pending
// places are the programs the pending tracks still wait on, each once, in shield order.
export interface BatchVerification {
  ok: number
  mismatch: number
  pending: number
  checking: number
  unverified: number
  pendingPlaces: VerifyPlace[]
}

function batchVerification(tracks: TrackItem[]): BatchVerification {
  const batch = { ok: 0, mismatch: 0, pending: 0, checking: 0, unverified: 0 }
  const waiting = new Set<VerifyPlace>()
  for (const t of tracks) {
    const v = t.verification
    if (!v) {
      batch.unverified += 1
      continue
    }
    batch[v.status] += 1
    if (v.status === 'pending')
      for (const c of v.checks) if (c.state === 'pending') waiting.add(c.place)
  }
  return { ...batch, pendingPlaces: PLACE_ORDER.filter((p) => waiting.has(p)) }
}

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
  // Multi-select only: the batch's re-read, tallied.
  batch?: BatchVerification
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
  // nothing distinct to trash. Single-track only, gone once the original is trashed, and
  // held back until the self-check found everything in place.
  const canDeleteOriginal =
    !isMulti &&
    !!item.outputPath &&
    item.outputPath !== item.inputPath &&
    !item.originalTrashed &&
    item.verification?.status === 'ok'
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
  // never both appear. Each track is judged by supersededFile itself, so the batch drops
  // exactly what the single-track link would: unfinished, already trashed, the source the
  // footer offers as original, and a file the old Music entry may still play.
  const superseded = isMulti
    ? multiTracks.flatMap((t) => {
        const path = supersededFile(t)
        return path ? [{ trackId: t.id, path }] : []
      })
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
    batch: isMulti ? batchVerification(multiTracks) : undefined,
  }
}
