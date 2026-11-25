import type { DjProgram } from '../../../shared/djProgram'
import { MATCHING_ID } from '../../../shared/matching'
import type { CollectionTrack, SourcePlaylistEntry } from '../../../shared/types'
import type { SourceBrowser } from '../hooks/useSourceBrowser'

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

export interface MatchingSuggestionContext {
  inRekordbox: boolean
  collectionById: ReadonlyMap<string, CollectionTrack>
  programById: ReadonlyMap<string, CollectionTrack>
  selectedContentId: string | undefined
  matchingSelfPath: string | null
  matchingPairs: [string, string][] | undefined
  matchingPathPairs: [string, string][]
  sourceProgram: DjProgram | null
  browser: Pick<SourceBrowser, 'playlist'>
}

export interface MatchingSuggestionSource {
  suggestionTracks: ReadonlyMap<string, CollectionTrack>
  suggestionSelf: string | null | undefined
  matchedPairs: [string, string][] | undefined
  inMatching: boolean
}

export function matchingSuggestionSourceOf({
  inRekordbox,
  collectionById,
  programById,
  selectedContentId,
  matchingSelfPath,
  matchingPairs,
  matchingPathPairs,
  sourceProgram,
  browser,
}: MatchingSuggestionContext): MatchingSuggestionSource {
  return {
    suggestionTracks: inRekordbox ? collectionById : programById,
    suggestionSelf: inRekordbox ? selectedContentId : matchingSelfPath,
    matchedPairs: inRekordbox ? matchingPairs : matchingPathPairs,
    inMatching: sourceProgram !== null && browser.playlist?.id === MATCHING_ID,
  }
}
