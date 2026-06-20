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

// Small spelled-out numbers, for the digit↔word equivalence below ("A7" == "A Seven").
const NUMBER_WORDS: Record<string, string> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
}

// A leading DJ/Dr./MC handle (folded to a bare word) — noise around the same act. The
// trailing space in the pattern means a lone "dj"/"mc" artist is never stripped to nothing.
const HANDLE_PREFIX = /^(?:(?:dj|dr|mc) )+/

// Folds an artist into a canonical word set for matching:
//  - collapse a run of two or more single letters into one word, so a dotted acronym
//    ("DJ F.R.A.N.K." → "dj f r a n k") meets its solid spelling ("DJ. Frank" → "dj frank");
//    a lone trailing initial ("Ricardo F") isn't a run and stays its own word;
//  - split a letter/digit boundary so a joined "A7" reads as "a 7";
//  - turn a spelled-out small number into its digit, so "A Seven" matches "A7";
//  - drop a leading DJ/Dr./MC handle, so "DJ Raúl Soto" meets the library's "Raul Soto".
// The collapse runs first so the split's "a 7" isn't re-joined back into "a7".
function foldArtist(artist: string): string {
  return foldText(artist)
    .replace(/\b(?:[a-z0-9] ){1,}[a-z0-9]\b/g, (run) => run.replace(/ /g, ''))
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(
      /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/g,
      (w) => NUMBER_WORDS[w],
    )
    .replace(HANDLE_PREFIX, '')
}

// The lead artist only, folded: keep everything before the first collaborator separator,
// then fold. cleanName drops a Discogs disambiguator ("Aphex Twin (2)") so it matches the
// plain library name.
function primaryArtist(artist: string): string {
  return foldArtist(cleanName(artist.split(COLLAB_SEP)[0]))
}

// A trailing parenthesised or bracketed version suffix — "(Happy House)", "[Radio Edit]".
// One or more trailing ()/[] version groups — a rip can stack reissue markers
// ("(Original) (Remastered)"), so peel them all to reach the base title, not just the last.
const VERSION_SUFFIX = /(?:\s*[([][^)\]]*[)\]]\s*)+$/

// The folded title keys a track is indexed and looked up under: the full title, the base
// title with a trailing version suffix stripped, and — for either — the title with a leading
// copy of the artist removed. DJ rips often tag just the base name ("It's Not Over") while
// the Apple Music copy keeps the release's version ("It's Not Over (Happy House)"), or tag
// the title as "Artist – Title" ("Debby – Maybe…"); keying off all these lets the library
// hint bridge those gaps and stay consistent with the editor's badge. Variants are kept in a
// Set so an unchanged one (no suffix, no prefix) isn't duplicated.
function titleKeys(title: string, artist: string): string[] {
  const keys = new Set<string>()
  const folded = foldText(artist)
  for (const variant of [foldText(title), foldText(title.replace(VERSION_SUFFIX, ''))]) {
    if (!variant) continue
    keys.add(variant)
    // "Artist – Title" tags: key off the bare title so it matches the library's clean one.
    if (folded && variant.startsWith(`${folded} `)) keys.add(variant.slice(folded.length + 1))
  }
  return [...keys]
}

export function buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): AppleMusicIndex {
  const index: AppleMusicIndex = new Map()
  for (const { title, artist } of tracks) {
    const folded = foldArtist(artist)
    // An empty artist can't identify a song and would later `every`-match nothing
    // meaningfully; skip the row entirely.
    if (!folded) continue
    for (const key of titleKeys(title, artist)) {
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
  // The candidate's lead artist and a library artist are the same act when one's words are
  // wholly contained in the other's — either direction. The library copy is often the
  // shorter spelling (the tag adds a "Dr." prefix, an "On A Vinyl" descriptor, a "presents"
  // credit), while sometimes it carries the extra words (a "& Friends" suffix). Whole-word
  // both ways, so a partial name ("Mat") still never matches a longer one ("Matador").
  const candidateSet = new Set(primaryWords)
  const artistMatches = (a: string): boolean => {
    const libraryWords = a.split(' ')
    const librarySet = new Set(libraryWords)
    return (
      primaryWords.every((w) => librarySet.has(w)) || libraryWords.every((w) => candidateSet.has(w))
    )
  }
  return titleKeys(candidate.title, candidate.artist).some((key) => {
    if (!key) return false
    return index.get(key)?.some(artistMatches) ?? false
  })
}
