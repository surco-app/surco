import type { SessionEdit } from '../../../shared/types'
import type { TrackItem } from '../types'

// The editable state worth surviving a crash: everything the user can change in the
// editor before converting, keyed by the source path (track ids are minted fresh
// every import). Display URLs that die with the renderer (blob:) or re-derive from
// the file itself (the embedded-art data: thumb) stay out — a blob-covered track
// keeps its coverPath and main mints a fresh preview at load.
export function sessionEdits(tracks: TrackItem[]): Record<string, SessionEdit> {
  return Object.fromEntries(tracks.map((t) => [t.inputPath, sessionEdit(t)]))
}

function sessionEdit(track: TrackItem): SessionEdit {
  const edit: SessionEdit = { meta: track.meta }
  if (track.outputName) edit.outputName = track.outputName
  if (track.coverUrl?.startsWith('http')) edit.coverUrl = track.coverUrl
  if (track.coverPath) edit.coverPath = track.coverPath
  if (track.coverRemoved) edit.coverRemoved = true
  if (track.matched) edit.matched = true
  if (track.autoMatched) edit.autoMatched = true
  if (track.matchConfidence !== undefined) edit.matchConfidence = track.matchConfidence
  return edit
}
