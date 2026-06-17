import type { AppleMusicLookupCandidate } from '../../../shared/types'
import { foldText } from './normalizeText'

// A snapshot of the user's Apple Music library, keyed by canonical title so a track's
// "do I already own this?" check is a Map lookup instead of an osascript spawn. Each
// title maps to the folded artist strings of every library track under it, so the
// primary-artist `contains` match (see isInLibrary) can run in the renderer.
export type AppleMusicIndex = Map<string, string[]>

// The primary artist only, folded: our tags join collaborators ("Alfredo Pareja,
// Saint Etien") while Apple Music stores just the primary name, so the comma split
// happens before folding (which would turn the comma into a space and lose the boundary).
function primaryArtist(artist: string): string {
  return foldText(artist.split(',')[0])
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

// Whether the candidate (a track's live tags) is already in the library: the title
// must match exactly (after folding) and the candidate's primary artist must be
// contained in some library artist under that title. This mirrors the AppleScript
// lookup (`name is ... and artist contains ...`) so the list filter and the editor
// badge agree on what counts as "already owned". Like the badge, it's a hint, not a
// guarantee — naming that diverges past folding ("(Remix)" vs "- Re-Edit") still misses.
export function isInLibrary(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string },
): boolean {
  const key = foldText(candidate.title)
  const primary = primaryArtist(candidate.artist)
  if (!key || !primary) return false
  const artists = index.get(key)
  if (!artists) return false
  return artists.some((a) => a.includes(primary))
}
