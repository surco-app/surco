import type { SearchHints } from '../shared/types'
import { cleanQuery, dropTrackNumberTail, stripParentheticals } from '../shared/searchClean'

// Re-exported so existing callers/tests keep importing it from here; the implementation
// (and the rest of the cleaners) now lives in shared so the renderer's matcher reuses it.
export { cleanQuery }

// Ordered, de-duped queries to try in turn, most precise to most forgiving:
//   1. cleaned query (keeps a mix name so a remix still resolves)
//   2. same without any parenthetical (the bare title that usually works)
//   3. a duplicated, track-numbered tail cut off — then also without parentheticals
//   4. catalog number, near-unique on Discogs, when the track carries one
//   5. title alone, for when the artist string is wrong/junk
//   6. title + artist swapped, for a file name that had them backwards
// Hint-based candidates only appear when the caller supplies them. Falls back to the raw
// query so cleaning can never produce a blank search.
export function buildSearchCandidates(query: string, hints: SearchHints = {}): string[] {
  const cleaned = cleanQuery(query)
  const out: string[] = []
  const add = (candidate: string): void => {
    const trimmed = candidate.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  add(cleaned)
  add(stripParentheticals(cleaned))
  // A duplicated, track-numbered tail cut off — then also without parentheticals. Both
  // collapse to the candidates above (and are skipped) when there's no such tail.
  const trimmed = dropTrackNumberTail(cleaned)
  add(trimmed)
  add(stripParentheticals(trimmed))
  if (hints.catalogNumber) add(hints.catalogNumber)
  if (hints.title) add(cleanQuery(hints.title))
  if (hints.artist && hints.title) add(cleanQuery(`${hints.title} ${hints.artist}`))
  if (out.length === 0) add(query)
  return out
}
