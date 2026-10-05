import { foldAccents } from '../shared/foldAccents'
import {
  cleanQuery,
  dropDjPrefix,
  dropEchoedVersion,
  dropOriginalMarker,
  dropPresentsAlias,
  dropTrackNumberTail,
  stripParentheticals,
} from '../shared/searchClean'
import type { SearchHints, SearchResult } from '../shared/types'

// Re-exported so existing callers/tests keep importing it from here; the implementation
// (and the rest of the cleaners) now lives in shared so the renderer's matcher reuses it.
export { cleanQuery }

// Ordered, de-duped queries to try in turn, most useful to most forgiving. The de-duplicated
// title leads, minus a generic "(Original Mix)" marker — that bare title is what resolves on
// Discogs, while keeping it drags free-text search (Bandcamp especially) into noise that, by
// returning *something*, blocks the bare fallback. A real mix name (Extended/Dub/Club…) is
// kept first, since it helps find the remix's own release; the version is recovered for the
// suggestion from the file's title regardless. Then come the bare-of-all-parens forms, the
// un-trimmed query (in case cutting a track-number tail removed something), and the hint
// candidates. Falls back to the raw query so cleaning can never produce a blank search.
export function buildSearchCandidates(
  query: string,
  hints: SearchHints = {},
  opts: { includeCatalog?: boolean; albumFirst?: boolean } = {},
): string[] {
  const cleaned = cleanQuery(query)
  const trimmed = dropTrackNumberTail(cleaned)
  const out: string[] = []
  const add = (candidate: string): void => {
    const t = candidate.trim()
    if (t && !out.includes(t)) out.push(t)
  }
  // "Search by album first": the tagged album names the one release the track came from,
  // where the track name alone drags in homonyms, so "artist album" leads and the track
  // ladder below follows when it finds nothing. The album only reaches here while the
  // setting is on (the provider seam drops it otherwise). Never without the artist: an
  // album name alone ("Greatest Hits") matches anyone's release, and any hit ends the loop
  // before the track is tried. Discogs runs its album search on the structured fields and
  // leaves this off, so its free-text ladder is unchanged.
  if (opts.albumFirst && hints.artist && hints.album)
    add(albumCandidateOf(hints.artist, hints.album))
  // A "presents"/"pres." alias in the artist drags free-text search onto unrelated
  // compilations; the catalog files the release under the lead act. Lead with the lead
  // artist + title so this clean candidate is tried before the noisy full query, whose
  // junk-but-non-empty results would otherwise break the candidate loop first.
  if (hints.artist && hints.title) {
    const lead = dropPresentsAlias(hints.artist)
    if (lead !== hints.artist) add(cleanQuery(`${lead} ${hints.title}`))
  }
  // dropEchoedVersion after dropOriginalMarker so an "(Original Mix)" still leads bare, while
  // a title-echoing "(Sunshine Version)" also collapses to the bare title that resolves.
  add(dropEchoedVersion(dropOriginalMarker(trimmed)))
  add(trimmed)
  add(stripParentheticals(trimmed))
  add(cleaned)
  add(stripParentheticals(cleaned))
  // A tag's "DJ " prefix where the catalog files the act bare ("DJ Miguel Serna, Alex
  // Cervera" vs Bandcamp's "Miguel Serna, Alex Cervera") makes every full form above
  // return nothing — Bandcamp's autocomplete needs all terms to match. Retry without the
  // prefix, then with the lead act alone (a comma-separated credit often lists acts the
  // catalog doesn't), before the bare title whose homonym noise would end the candidate
  // loop on the wrong releases. An act genuinely carrying the prefix (DJ Tieum) is
  // unaffected: its full query already resolves, so the loop never reaches these. An "&"
  // is one more term to match, and "Miguel Serna & Álex Cervera" is filed "Miguel Serna,
  // Alex Cervera", so the acts are retried without it. Only commas split acts — "&" joins
  // duos the catalog files whole ("Simon & Garfunkel").
  if (hints.artist && hints.title) {
    const bare = dropDjPrefix(hints.artist)
    if (bare !== hints.artist) add(cleanQuery(`${bare} ${hints.title}`))
    const unjoined = bare.replace(/\s*&\s*/g, ' ')
    if (unjoined !== bare) add(cleanQuery(`${unjoined} ${hints.title}`))
    const lead = bare.split(',')[0].trim()
    if (lead && lead !== bare) add(cleanQuery(`${lead} ${hints.title}`))
  }
  // Bandcamp has no catalog index, so the code matches dozens of unrelated releases and —
  // since the search loop keeps the first candidate that returns *anything* — would mask the
  // real release; callers searching it pass includeCatalog: false. Discogs (default) keeps it.
  if (opts.includeCatalog !== false && hints.catalogNumber) add(hints.catalogNumber)
  if (hints.title) add(cleanQuery(hints.title))
  if (hints.artist && hints.title) add(cleanQuery(`${hints.title} ${hints.artist}`))
  if (out.length === 0) add(query)
  return out
}

function albumCandidateOf(artist: string, album: string): string {
  return cleanQuery(`${artist} ${album}`).trim()
}

// Whole words only, accents folded, so "Moby" is not found inside "Monoplay" and
// "Rosalia" still matches "ROSALÍA".
function wordsOf(text: string): string {
  return ` ${foldAccents(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()} `
}

const ACT_SEPARATOR =
  /\s*(?:,|&|\+|\/|\sx\s|\b(?:vs|feat|ft|pres)\.?(?=\s)|\b(?:featuring|presents|aka)\b)\s*/i
const TOO_GENERIC = /^(?:dj|the|a|an|el|la|los|las|le|les|de|di|der|die)$/i
const SORTED_ARTICLE = /^(.+),\s*(the|los|las|el|la|les|le|die)$/i

// The acts a row may name for the file's artist: the whole credit, the credit without a
// "DJ " prefix, a library-sorted "Brown Brothers, The" turned back around, and each act of
// a collaboration split on commas, "&", "+", "/", " x ", "vs", "aka", "pres."/"presents"
// and "feat."/"ft."/"featuring" (the catalog often files a release under the lead act
// alone). "and" does not split: too many acts carry it in their name. A single letter, a
// bare "DJ" or a lone article is no act, since nearly any row would name it; an act split
// off a collaboration needs three letters, since "Housecream Feat. Jo'" accepted another
// Jo's releases in the library sweep, while a short act credited alone is the whole credit.
export function actsOf(artist: string): string[] {
  const letters = (a: string): number => a.replace(/[^\p{L}\p{N}]/gu, '').length
  const isAct = (a: string, min: number): boolean =>
    letters(a) >= min && !TOO_GENERIC.test(a.trim())
  const sorted = artist.match(SORTED_ARTICLE)
  const whole = [artist, dropDjPrefix(artist), ...(sorted ? [`${sorted[2]} ${sorted[1]}`] : [])]
  const split = artist.split(ACT_SEPARATOR).map((a) => dropDjPrefix(a.trim()))
  return [...new Set([...whole.filter((a) => isAct(a, 2)), ...split.filter((a) => isAct(a, 3))])]
}

// An act spelled apart or together ("Pro-Active" and "Proactive", "D Sigual" and
// "Dsigual") is still the same act, so a run of whole words in the row, joined, may also
// equal the act joined. Always a run of whole words, never part of one, so "Dsigual"
// is not found inside "Prodsigual"; and only for acts of four or more letters, where a
// joined run is unlikely to spell another act by accident.
function namesActJoined(title: string, act: string): boolean {
  const target = wordsOf(act).replace(/ /g, '')
  if (target.length < 4) return false
  const words = wordsOf(title).trim().split(' ')
  for (let i = 0; i < words.length; i++) {
    let joined = ''
    for (let j = i; j < words.length && joined.length < target.length; j++) {
      joined += words[j]
      if (joined === target) return true
    }
  }
  return false
}

function namesAct(title: string, act: string): boolean {
  return wordsOf(title).includes(wordsOf(act)) || namesActJoined(title, act)
}

export function namesArtist(result: SearchResult, artist: string): boolean {
  return actsOf(artist).some((act) => namesAct(result.title, act))
}

// The free-text providers' shared loop (Bandcamp, Deezer, Beatport, and MusicBrainz'
// free text): each candidate in turn, keeping the first whose rows name the file's artist.
// Fuzzy search always answers something, so the first rung that returns anything was often
// another act's homonym ("Autumn Tactics" by Sola Brothers brought Chicane's original from
// three sources, and "Moby Play" brings Monoplay): a rung where no row names the artist
// counts as not found and the next is tried, and a ladder where none does comes back
// empty. The rows of the rung that stands are kept whole, since a compilation that holds
// the track names its own curator, not the act. A library sweep of 120 tracks measured
// this taking junk-only answers from 25-39% of tracks to 0-9% and losing no row that named
// the act. With no artist on the file there is nothing to check against, and the first
// rung that answers anything is kept, as before. The album candidate is always held to it:
// an album name alone matches anyone's release.
export async function searchCandidates(
  query: string,
  hints: SearchHints,
  searchOnce: (candidate: string) => Promise<SearchResult[]>,
): Promise<SearchResult[]> {
  const artist = hints.artist ?? ''
  const guarded = actsOf(artist).length > 0
  const albumCandidate = artist && hints.album ? albumCandidateOf(artist, hints.album) : undefined
  for (const candidate of buildSearchCandidates(query, hints, {
    includeCatalog: false,
    albumFirst: true,
  })) {
    const results = await searchOnce(candidate)
    const mustName = guarded || candidate === albumCandidate
    if (mustName ? results.some((r) => namesArtist(r, artist)) : results.length) return results
  }
  return []
}
