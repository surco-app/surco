import type { SourcePlaylistEntry } from '../../../shared/types'

export interface MatchingPartner {
  contentId: string
  path: string
  title: string
  artist: string
  key: string
}

export function partnersOf(
  pairs: readonly (readonly [string, string])[],
  contentId: string,
  entries: readonly SourcePlaylistEntry[],
): MatchingPartner[] {
  const ids = new Set(
    pairs.flatMap(([a, b]) => (a === contentId ? [b] : b === contentId ? [a] : [])),
  )
  ids.delete(contentId)
  const byId = new Map(entries.map((e) => [e.contentId, e]))
  return [...ids].flatMap((id) => {
    const e = byId.get(id)
    if (!e?.path || e.separator || !e.preview) return []
    return [
      {
        contentId: id,
        path: e.path,
        title: e.preview.title,
        artist: e.preview.artist,
        key: e.meta.key ?? '',
      },
    ]
  })
}
