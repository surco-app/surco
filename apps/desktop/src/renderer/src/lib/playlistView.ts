import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'

// The crate narrowed to one playlist and put in the playlist's order. The crate itself is
// untouched — every loaded track keeps its edits whichever playlist is on screen — so this
// is a view, applied before the filters and sort the list already has.
//
// Paths are compared composed: the NAS stores names decomposed while Surco works composed
// (same rule as appleMusicPlaylists.entryForFile).
export function playlistView(
  tracks: TrackItem[],
  entries: SourcePlaylistEntry[],
): { tracks: TrackItem[]; separatorBefore: ReadonlySet<string> } {
  const byPath = new Map(tracks.map((t) => [t.inputPath.normalize('NFC'), t]))
  const shown: TrackItem[] = []
  const seen = new Set<string>()
  const separatorBefore = new Set<string>()
  let pendingBreak = false
  for (const e of entries) {
    if (e.separator) {
      pendingBreak = true
      continue
    }
    const t = e.path ? byPath.get(e.path.normalize('NFC')) : undefined
    if (!t || seen.has(t.id)) continue
    seen.add(t.id)
    shown.push(t)
    if (pendingBreak) separatorBefore.add(t.id)
    pendingBreak = false
  }
  return { tracks: shown, separatorBefore }
}

export function playlistCounts(entries: SourcePlaylistEntry[]): { tracks: number; separators: number } {
  const separators = entries.filter((e) => e.separator).length
  return { tracks: entries.length - separators, separators }
}
