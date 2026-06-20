import type { AppleMusicLookupCandidate } from '../../../shared/types'
import { foldText } from './normalizeText'
import { cleanName } from './release'

// A snapshot of the user's Apple Music library, keyed by canonical title so a track's
// "do I already own this?" check is a Map lookup instead of an osascript spawn. Each
// title maps to the folded artist strings of every library track under it, so the
// primary-artist word match (see isInLibrary) can run in the renderer.
export type AppleMusicIndex = Map<string, string[]>

// Collaborator separators, matched on the raw artist string (the split happens before
// folding, which would turn a comma/ampersand into a space and lose the boundary): a comma
// or ampersand joining co-artists, or an inline feature clause. Our tags join collaborators
// ("Alfredo Pareja, Saint Etien", "Head Horny's & DJ Miguel Serna") while Apple Music files
// the track under just the lead — often spelled shorter ("Head Horny's & Miguel Serna"), so
// requiring every co-artist's words to appear would read the collaboration as not-owned.
const COLLAB_SEP = /\s*[,&]\s*|\s+(?:feat\.?|featuring|ft\.?)\s+/i

// The lead artist only, folded: keep everything before the first collaborator separator,
// then fold. cleanName drops a Discogs disambiguator ("Aphex Twin (2)") so it matches the
// plain library name.
function primaryArtist(artist: string): string {
  return foldText(cleanName(artist.split(COLLAB_SEP)[0]))
}

// A trailing parenthesised or bracketed version suffix — "(Happy House)", "[Radio Edit]".
const VERSION_SUFFIX = /\s*[([][^)\]]*[)\]]\s*$/

// The folded title keys a track is indexed and looked up under: the full title, plus the
// base title with a trailing version suffix stripped. DJ rips often tag just the base
// name ("It's Not Over") while the Apple Music copy keeps the release's version
// ("It's Not Over (Happy House)"); indexing and matching both keys lets the library hint
// bridge that gap — and stay consistent with the editor's badge, which catches the same
// song under its canonical Discogs name. The base is only added when it differs.
function titleKeys(title: string): string[] {
  const full = foldText(title)
  const base = foldText(title.replace(VERSION_SUFFIX, ''))
  return base && base !== full ? [full, base] : [full]
}

export function buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): AppleMusicIndex {
  const index: AppleMusicIndex = new Map()
  for (const { title, artist } of tracks) {
    const folded = foldText(artist)
    // An empty artist can't identify a song and would later `every`-match nothing
    // meaningfully; skip the row entirely.
    if (!folded) continue
    for (const key of titleKeys(title)) {
      if (!key) continue
      const list = index.get(key)
      if (list) list.push(folded)
      else index.set(key, [folded])
    }
  }
  return index
}

// Whether the candidate (a track's live tags) is already in the library: a title key must
// match (the full folded title or its version-stripped base) and every word of the
// candidate's primary artist must appear as a whole word in some library artist under that
// title. Matching on whole words rather than a raw substring stops a primary artist from
// matching an unrelated longer name it merely sits inside ("Mat" vs "Matador"), while
// still allowing the library's extra words (a "& Friends" suffix, a featured act). It's a
// hint, not a guarantee.
export function isInLibrary(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string },
): boolean {
  const primary = primaryArtist(candidate.artist)
  if (!primary) return false
  const primaryWords = primary.split(' ')
  const artistMatches = (a: string): boolean => {
    const have = new Set(a.split(' '))
    return primaryWords.every((w) => have.has(w))
  }
  return titleKeys(candidate.title).some((key) => {
    if (!key) return false
    return index.get(key)?.some(artistMatches) ?? false
  })
}
