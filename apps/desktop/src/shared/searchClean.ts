// Free-text search (Discogs' q=, Bandcamp's autocomplete) and the tracklist scorer both
// choke on download-file-name noise that a hand-typed search would never include. These
// pure helpers strip that noise; they live in shared so the main-process clients and the
// renderer's matcher clean identically.

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

export function squeeze(s: string): string {
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

export function stripParentheticals(query: string): string {
  return squeeze(query.replace(/\([^)]*\)/g, ' '))
}

// DJ-pool / batch exports often append a track number and a repeat of the artist–title to
// the end ("Artist - Title (Original Mix) - 02 Artist - Title (Original Mix)"). The part
// before that mid-string track number is already a complete query, and the duplication
// throws free-text search off (Bandcamp's autocomplete returns nothing). Cut from the
// first " - NN " — a 1-3 digit track number, never a 4-digit year — onward. Leaves a
// string with no such marker unchanged, so it only ever helps.
export function dropTrackNumberTail(query: string): string {
  return squeeze(query.replace(/\s-\s\d{1,3}(?:\s.*)?$/, ''))
}

// The title to score a tracklist entry against: the same noise and duplicated track-number
// tail removed that the search strips, so a confident match still lands when the file's
// title tag is really the whole (often duplicated) file name. A clean title is unchanged.
export function cleanMatchTitle(title: string): string {
  return dropTrackNumberTail(cleanQuery(title))
}
