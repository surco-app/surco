import type { SourcePlaylistEntry } from '../../../shared/types'
import type { TrackItem } from '../types'

// The crate narrowed to one playlist and put in the playlist's order. The crate itself is
// untouched — every loaded track keeps its edits whichever playlist is on screen — so this
// is a view, applied before the filters and sort the list already has.
//
// Paths are compared composed: the NAS stores names decomposed while Surco works composed
// (same rule as appleMusicPlaylists.entryForFile). A track is also found by its output: a
// conversion that is not in place repoints the rekordbox row at the new file. A track
// loaded from a path wins over one that converted into it, so outputs go in first and
// inputs overwrite them.
export function playlistView(
  tracks: TrackItem[],
  entries: SourcePlaylistEntry[],
): { tracks: TrackItem[]; separatorBefore: ReadonlySet<string> } {
  const byPath = new Map<string, TrackItem>()
  for (const t of tracks) if (t.outputPath) byPath.set(t.outputPath.normalize('NFC'), t)
  for (const t of tracks) byPath.set(t.inputPath.normalize('NFC'), t)
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

// Whether a track belongs to the open playlist, by the same path rules as playlistView, for
// the background sweeps: they work on the playlist on screen, not on every playlist the
// working list has gathered on the way.
export function playlistMembership(
  entries: readonly SourcePlaylistEntry[],
): (track: TrackItem) => boolean {
  const paths = new Set(
    entries.flatMap((e) => (e.path && !e.separator ? [e.path.normalize('NFC')] : [])),
  )
  return (t) =>
    paths.has(t.inputPath.normalize('NFC')) ||
    (!!t.outputPath && paths.has(t.outputPath.normalize('NFC')))
}
