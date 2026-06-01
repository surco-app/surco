export interface ParsedName {
  fileName: string
  artist: string
  title: string
  query: string
}

// Tracks are named "Artist - Title.ext". We split on the first " - " so that
// titles containing " - " (e.g. remixes) stay intact, and use the cleaned
// artist + title as the Discogs search query.
export function parseFileName(path: string): ParsedName {
  const base = path.split('/').pop() ?? path
  const fileName = base.replace(/\.[^.]+$/, '')

  const sep = fileName.indexOf(' - ')
  if (sep === -1) {
    return { fileName, artist: '', title: fileName, query: fileName }
  }

  const artist = fileName.slice(0, sep).trim()
  const title = fileName.slice(sep + 3).trim()
  return { fileName, artist, title, query: `${artist} ${title}`.trim() }
}
