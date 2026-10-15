import type { TFunction } from 'i18next'
import type { PlaylistSource, SourcePlaylistEntry } from '../../../shared/types'
import type { ReviewFilter } from '../hooks/useMusicReview'
import type { TrackItem } from '../types'
import type { MusicScopeMode } from './reviewSource'

// What "Revisar metadatos" would read with the source rail as it is: the working list, the
// rows of an open rekordbox playlist (reviewed through their files), or the entries of an
// open Music playlist (reviewed in Apple Music). The count is what that review loads.
export type ReviewTarget =
  | { kind: 'list'; count: number }
  | { kind: 'playlist'; name: string; paths: ReadonlySet<string>; count: number }
  | { kind: 'music'; name: string; ids: ReadonlySet<string>; count: number }

// The review App keeps open: which engine, which filter it opened on, and the rows it was
// opened for. No paths is the whole working list; no scope is the whole Music library.
export type ReviewOpening =
  | { source: 'list'; filter: ReviewFilter; paths?: ReadonlySet<string> }
  | {
      source: 'music'
      filter: ReviewFilter
      scope?: { ids: ReadonlySet<string>; mode: MusicScopeMode }
    }

// playlistTracks is the open playlist's rows once they are applied (App's playlistScope):
// until then the list shows the working list, and a click acts on the rows shown.
export function reviewTarget({
  source,
  playlistName,
  entries,
  playlistTracks,
  workingCount,
}: {
  source: PlaylistSource | null
  playlistName: string | null
  entries: SourcePlaylistEntry[] | undefined
  playlistTracks: TrackItem[] | null
  workingCount: number
}): ReviewTarget {
  if (!playlistTracks || playlistName === null) return { kind: 'list', count: workingCount }
  if (source === 'appleMusic') {
    // One per Music entry: a row with no file has no ID and the Music review never sees it.
    const ids = new Set(
      (entries ?? []).flatMap((e) => (e.musicPersistentId ? [e.musicPersistentId] : [])),
    )
    return { kind: 'music', name: playlistName, ids, count: ids.size }
  }
  return {
    kind: 'playlist',
    name: playlistName,
    paths: new Set(playlistTracks.map((t) => t.inputPath)),
    count: playlistTracks.length,
  }
}

// Null when there is nothing to review: opening anyway would show the review's empty state,
// which for Music says the whole library is empty.
export function reviewOpening(
  target: ReviewTarget,
  filter: 'all' | 'duplicates',
): ReviewOpening | null {
  if (target.count === 0) return null
  if (target.kind === 'music')
    return {
      source: 'music',
      filter,
      scope: { ids: target.ids, mode: filter === 'duplicates' ? 'duplicates' : 'tracks' },
    }
  return target.kind === 'playlist'
    ? { source: 'list', filter, paths: target.paths }
    : { source: 'list', filter }
}

export function reviewDetail(tr: TFunction, target: ReviewTarget): string {
  if (target.kind === 'list') return tr('header.menu.scope.list', { count: target.count })
  if (target.kind === 'playlist')
    return tr('header.menu.scope.playlistFiles', { count: target.count, name: target.name })
  return tr('header.menu.scope.playlistMusic', { count: target.count, name: target.name })
}

export function duplicatesDetail(tr: TFunction, name: string): string {
  return tr('header.menu.scope.duplicates', { name })
}
