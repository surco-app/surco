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
//
// Separators are kept one by one, each under its own key (its playlist row), so each can be
// dragged and removed; one in a run or after the last row is not folded away. Each shown
// track also knows its first row in the playlist, every row it has there, and its
// collection entry: a drag moves all its rows, a copy links that entry.
export interface PlaylistScope {
  tracks: TrackItem[]
  separatorBefore: ReadonlyMap<string, readonly string[]>
  trailingSeparators: readonly string[]
  linkOf: ReadonlyMap<string, string>
  linksOf: ReadonlyMap<string, readonly string[]>
  contentOf: ReadonlyMap<string, string>
}

export function playlistView(tracks: TrackItem[], entries: SourcePlaylistEntry[]): PlaylistScope {
  const byPath = new Map<string, TrackItem>()
  for (const t of tracks) if (t.outputPath) byPath.set(t.outputPath.normalize('NFC'), t)
  for (const t of tracks) byPath.set(t.inputPath.normalize('NFC'), t)
  const shown: TrackItem[] = []
  const seen = new Set<string>()
  const separatorBefore = new Map<string, string[]>()
  const linkOf = new Map<string, string>()
  const linksOf = new Map<string, string[]>()
  const contentOf = new Map<string, string>()
  let pending: string[] = []
  // A separator with no row id of its own is keyed by the row it follows and its place in
  // that run, so a row added elsewhere does not rename it.
  let after = ''
  const runs = new Map<string, number>()
  entries.forEach((e) => {
    if (e.separator) {
      const n = runs.get(after) ?? 0
      runs.set(after, n + 1)
      pending.push(e.linkId ?? `sep-${after}-${n}`)
      return
    }
    after = e.path ?? ''
    const t = e.path ? byPath.get(e.path.normalize('NFC')) : undefined
    if (t && e.linkId) linksOf.set(t.id, [...(linksOf.get(t.id) ?? []), e.linkId])
    if (!t || seen.has(t.id)) return
    seen.add(t.id)
    shown.push(t)
    if (e.linkId) linkOf.set(t.id, e.linkId)
    if (e.contentId) contentOf.set(t.id, e.contentId)
    if (pending.length) separatorBefore.set(t.id, pending)
    pending = []
  })
  return { tracks: shown, separatorBefore, trailingSeparators: pending, linkOf, linksOf, contentOf }
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
