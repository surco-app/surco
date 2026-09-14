import type { SessionEdit } from '../../../shared/types'
import type { TrackItem } from '../types'
import { trackSignature } from './dirty'

// The editable state worth surviving a crash: everything the user can change in the
// editor before converting, keyed by the source path (track ids are minted fresh
// every import). Display URLs that die with the renderer (blob:) or re-derive from
// the file itself (the embedded-art data: thumb) stay out — a blob-covered track
// keeps its coverPath and main mints a fresh preview at load.
//
// Only tracks whose state diverges from what some file already carries are included:
// a clean track restores identically from the file itself, and the map being empty
// is how the reopen offer knows expiring costs nothing (with staged edits it waits
// for an explicit answer instead).
export function sessionEdits(tracks: TrackItem[]): Record<string, SessionEdit> {
  return Object.fromEntries(tracks.filter(hasStagedEdits).map((t) => [t.inputPath, sessionEdit(t)]))
}

// Whether the track's live state has diverged from what the file on disk carries —
// the edits a crash (or a removal) would cost. Exported because the same question
// decides whether discarding a row is worth confirming.
export function hasStagedEdits(track: TrackItem): boolean {
  return track.diskSignature !== undefined && trackSignature(track) !== track.diskSignature
}

function sessionEdit(track: TrackItem): SessionEdit {
  const edit: SessionEdit = { meta: track.meta }
  if (track.outputName) edit.outputName = track.outputName
  if (track.coverUrl?.startsWith('http')) edit.coverUrl = track.coverUrl
  if (track.coverPath) edit.coverPath = track.coverPath
  // What the track's library copy is, and that it came from a playlist. Both are read
  // back at reopen: without the first the convert button offers to ADD a track that is
  // already in the library (a second copy of the same song), and without the second the
  // conversion stops honouring the source's own format.
  if (track.musicPersistentId) edit.musicPersistentId = track.musicPersistentId
  if (track.fromAppleMusic) edit.fromAppleMusic = true
  if (track.coverRemoved) edit.coverRemoved = true
  if (track.metaCleared) edit.metaCleared = true
  if (track.foreignRemoved?.length) edit.foreignRemoved = track.foreignRemoved
  if (track.matched) edit.matched = true
  if (track.autoMatched) edit.autoMatched = true
  if (track.matchConfidence !== undefined) edit.matchConfidence = track.matchConfidence
  if (track.matchProvider) edit.matchProvider = track.matchProvider
  if (track.trim) edit.trim = track.trim
  return edit
}
