import type { AppleMusicLookupCandidate } from '../../../shared/types'
import { foldText } from './normalizeText'
import { cleanName } from './release'

// A snapshot of the user's Apple Music library, keyed by canonical title so a track's
// "do I already own this?" check is a Map lookup instead of an osascript spawn. Each
// title maps to the folded artist strings of every library track under it, so the
// primary-artist word match (see isInLibrary) can run in the renderer.
export type AppleMusicIndex = Map<string, string[]>

// The primary artist only, folded: our tags join collaborators ("Alfredo Pareja,
// Saint Etien") while Apple Music stores just the primary name, so the comma split
// happens before folding (which would turn the comma into a space and lose the boundary).
// cleanName drops a Discogs disambiguator ("Aphex Twin (2)") so it matches the plain
// library name.
function primaryArtist(artist: string): string {
  return foldText(cleanName(artist.split(',')[0]))
}

export function buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): AppleMusicIndex {
  const index: AppleMusicIndex = new Map()
  for (const { title, artist } of tracks) {
    const key = foldText(title)
    const folded = foldText(artist)
    // A row missing either side can't identify a song; skipping it also keeps an
    // empty artist from later `includes("")`-matching every candidate.
    if (!key || !folded) continue
    const list = index.get(key)
    if (list) list.push(folded)
    else index.set(key, [folded])
  }
  return index
}

// Whether the candidate (a track's live tags) is already in the library: the title must
// match exactly (after folding) and every word of the candidate's primary artist must
// appear as a whole word in some library artist under that title. Matching on whole words
// rather than a raw substring stops a primary artist from matching an unrelated longer
// name it merely sits inside ("Mat" vs "Matador"), while still allowing the library's
// extra words (a "& Friends" suffix, a featured act). It's a hint, not a guarantee — and
// a touch stricter than the editor's osascript badge, which still uses substring `contains`.
export function isInLibrary(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string },
): boolean {
  const key = foldText(candidate.title)
  const primary = primaryArtist(candidate.artist)
  if (!key || !primary) return false
  const artists = index.get(key)
  if (!artists) return false
  const primaryWords = primary.split(' ')
  return artists.some((a) => {
    const have = new Set(a.split(' '))
    return primaryWords.every((w) => have.has(w))
  })
}
