import type { Release, ReleaseTrack } from '../../../shared/types'
import { joinArtists } from './release'

// The same reading main's Bandcamp parser gives a name: case-insensitive on collapsed
// whitespace. Exact on purpose (not sameAct's word containment): rewriting a title on a
// partial name would cut a real title like "Love - Song" for a file tagged "Love Inc".
function sameName(a: string, b: string): boolean {
  const fold = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return fold(a) === fold(b)
}

function withoutArtist(title: string, artist: string): string | undefined {
  for (const dash of title.matchAll(/\s+-\s+/g)) {
    const rest = title.slice(dash.index + dash[0].length).trim()
    if (rest && sameName(title.slice(0, dash.index), artist)) return rest
  }
  return undefined
}

// A label's Bandcamp page names the label as its artist and leaves the real act as an
// "Artist - " prefix inside the titles, which main only strips when it equals a page or
// track artist. The file's own artist tag is the corroboration main lacks: a prefix equal
// to it is the act, so it moves out of the titles into the artist, and the page artist (the
// label) moves to the label field. Done here, at score and apply time, so releases already
// in the lookup cache read the same as fresh ones.
export function readLabelPage(rel: Release, fileArtist: string | undefined): Release {
  const artist = fileArtist?.trim()
  const pageArtist = joinArtists(rel.artists)
  if (rel.provider === 'discogs' || !artist || sameName(pageArtist, artist)) return rel
  let rewritten = 0
  const tracklist = rel.tracklist.map((track): ReleaseTrack => {
    const title = withoutArtist(track.title, artist)
    if (title === undefined || sameName(joinArtists(track.artists), artist)) return track
    rewritten++
    return { ...track, title, artists: [{ name: artist }] }
  })
  const title = withoutArtist(rel.title, artist)
  if (rewritten === 0 && title === undefined) return rel
  const ownRelease = title !== undefined || rewritten === rel.tracklist.length
  return {
    ...rel,
    title: title ?? rel.title,
    artists: ownRelease ? [{ name: artist }] : [],
    labels: rel.labels?.length || !pageArtist ? rel.labels : [{ name: pageArtist, catno: '' }],
    tracklist,
  }
}
