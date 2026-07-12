import { smartDeriveTags } from './deriveTags'

export interface ParsedName {
  fileName: string
  artist: string
  title: string
  query: string
}

// Tracks are named "Artist - Title.ext", often behind a leading track number. The
// split runs through the same auto-detection as the fill-from-filename button
// (smartDeriveTags), so import and the button can never read one name two ways:
// titles containing " - " (e.g. remixes) stay intact, a numbered prefix is read as
// a number rather than part of the artist, and the cleaned artist + title feed the
// Discogs search query.
export function parseFileName(path: string): ParsedName {
  // Both separators: this runs in the renderer on raw OS paths, and Windows sends
  // backslashes — splitting on '/' alone left the whole route as the track's label
  // and search query there.
  const base = path.split(/[/\\]/).pop() ?? path
  const fileName = base.replace(/\.[^.]+$/, '')

  // Detection runs on the name WITH its extension: deriveTags strips the extension
  // itself, and handing it an already-stripped name would let that strip eat a
  // dotted artist ("Acer vs. The Beeper - …") instead.
  const tags = smartDeriveTags(base)
  if (tags.artist && tags.title) {
    return {
      fileName,
      artist: tags.artist,
      title: tags.title,
      query: `${tags.artist} ${tags.title}`,
    }
  }
  return { fileName, artist: '', title: fileName, query: fileName }
}
