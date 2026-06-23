import type { SearchHints } from '../shared/types'
import {
  cleanQuery,
  dropEchoedVersion,
  dropOriginalMarker,
  dropPresentsAlias,
  dropTrackNumberTail,
  stripParentheticals,
} from '../shared/searchClean'

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
  opts: { includeCatalog?: boolean } = {},
): string[] {
  const cleaned = cleanQuery(query)
  const trimmed = dropTrackNumberTail(cleaned)
  const out: string[] = []
  const add = (candidate: string): void => {
    const t = candidate.trim()
    if (t && !out.includes(t)) out.push(t)
  }
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
  // Bandcamp has no catalog index, so the code matches dozens of unrelated releases and —
  // since the search loop keeps the first candidate that returns *anything* — would mask the
  // real release; callers searching it pass includeCatalog: false. Discogs (default) keeps it.
  if (opts.includeCatalog !== false && hints.catalogNumber) add(hints.catalogNumber)
  if (hints.title) add(cleanQuery(hints.title))
  if (hints.artist && hints.title) add(cleanQuery(`${hints.title} ${hints.artist}`))
  if (out.length === 0) add(query)
  return out
}
