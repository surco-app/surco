import type { SearchHints } from '../shared/types'

// Discogs is searched through the free-text q= parameter, so anything in the query
// that isn't part of the actual artist/title throws the match off — exactly the
// download-filename noise ("320 flac", "[LABEL001]", "feat. X") that a hand-typed
// Google search leaves out. These helpers strip that noise and build an ordered
// list of candidates to try, from most precise to most forgiving.

// Pure source/format noise: it shows up in file names but never in a release title.
const NOISE: RegExp[] = [
  /\bhttps?:\/\/\S+/gi,
  /\bwww\.\S+/gi,
  // Bracketed groups are provenance — labels, catalog numbers, source tags.
  /\[[^\]]*\]/g,
  // feat./ft./featuring and the credited name, up to a parenthetical or the end.
  /\b(?:feat\.?|ft\.?|featuring)\b[^([]*/gi,
  // Bitrate, with or without the k/kbps suffix.
  /\b(?:320|256|224|192|160|128|96)\s*k(?:bps)?\b/gi,
  /\b(?:320|256|224|192|160|128|96)\b/g,
  // Container/codec and quality tags.
  /\b(?:flac|wav|aiff?|mp3|m4a|aac|ogg|opus)\b/gi,
  /\b(?:hq|hd|vbr|cbr|lossless|kbps)\b/gi,
]

function squeeze(s: string): string {
  return s
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function cleanQuery(query: string): string {
  let out = query
  for (const re of NOISE) out = out.replace(re, ' ')
  return squeeze(out)
}

function stripParentheticals(query: string): string {
  return squeeze(query.replace(/\([^)]*\)/g, ' '))
}

// Ordered, de-duped queries to try in turn, most precise to most forgiving:
//   1. cleaned query (keeps a mix name so a remix still resolves)
//   2. same without any parenthetical (the bare title that usually works)
//   3. catalog number, near-unique on Discogs, when the track carries one
//   4. title alone, for when the artist string is wrong/junk
//   5. title + artist swapped, for a file name that had them backwards
// Hint-based candidates (3-5) only appear when the caller supplies them. Falls back
// to the raw query so cleaning can never produce a blank search.
export function buildSearchCandidates(query: string, hints: SearchHints = {}): string[] {
  const cleaned = cleanQuery(query)
  const out: string[] = []
  const add = (candidate: string): void => {
    const trimmed = candidate.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  add(cleaned)
  add(stripParentheticals(cleaned))
  if (hints.catalogNumber) add(hints.catalogNumber)
  if (hints.title) add(cleanQuery(hints.title))
  if (hints.artist && hints.title) add(cleanQuery(`${hints.title} ${hints.artist}`))
  if (out.length === 0) add(query)
  return out
}
