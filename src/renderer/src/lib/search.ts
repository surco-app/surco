import type { ParsedName } from './filename'
import type { TrackMetadata } from '../../shared/types'

export interface ResolvedSearch {
  title: string
  artist: string
  query: string
}

// The file's embedded tags beat the file name for a Discogs search: a clean
// "Artist Title" from metadata finds the release reliably. The parsed file name
// is the fallback used only when the file carries no usable title/artist tag.
export function searchFromTags(
  parsed: ParsedName,
  tags: Pick<TrackMetadata, 'title' | 'artist'>
): ResolvedSearch {
  const title = tags.title.trim()
  const artist = tags.artist.trim()
  if (!title && !artist) {
    return { title: parsed.title, artist: parsed.artist, query: parsed.query }
  }
  return {
    title: title || parsed.title,
    artist: artist || parsed.artist,
    query: [artist, title].filter(Boolean).join(' ')
  }
}
