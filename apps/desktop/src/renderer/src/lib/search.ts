import type { TrackMetadata } from '../../../shared/types'
import type { ParsedName } from './filename'

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
  tags: Pick<TrackMetadata, 'title' | 'artist'>,
): ResolvedSearch {
  const title = tags.title.trim()
  const artist = tags.artist.trim()
  if (!title && !artist) {
    return { title: parsed.title, artist: parsed.artist, query: parsed.query }
  }
  return {
    title: title || parsed.title,
    artist: artist || parsed.artist,
    query: [artist, title].filter(Boolean).join(' '),
  }
}

// Discogs' text search treats a number as a search term, so a release id typed
// into the box finds nothing useful. Recognising an id — bare, as a release URL
// (any locale, slug optional), or as [r123] BBCode — lets the editor fetch it
// straight from /releases/{id} instead. Anything else stays a text search.
export function parseReleaseId(input: string): number | null {
  const q = input.trim()
  if (/^\d+$/.test(q)) return Number(q)
  const url = q.match(/discogs\.com\/(?:[a-z]{2}\/)?releases?\/(\d+)/i)
  if (url) return Number(url[1])
  const bb = q.match(/^\[r(\d+)\]$/i)
  if (bb) return Number(bb[1])
  return null
}
