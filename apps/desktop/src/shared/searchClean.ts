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

// A "presents"/"pres." credit names a side-alias ("Brian Cross pres. Fat Synth") that the
// catalog files under the lead act ("Brian Cross & Fat Synth"); for free-text search the
// alias is noise that drags the query onto unrelated compilations. Keep only the lead artist
// before the credit. Operates on an artist string (not the whole query, where the title sits
// after the alias and would be eaten too); returns the input unchanged with no such credit,
// and never strips to nothing.
export function dropPresentsAlias(artist: string): string {
  return squeeze(artist.replace(/\s+(?:pres\.?|presents)\b.*$/i, '')) || artist
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

// The track title to score a tracklist entry against. DJ-pool / batch file names front-load
// the release info ("Label - Artist - Album (Mix) - NN TrackTitle"); the segment AFTER the
// track number is the actual track — "Preview" (Bandcamp uses it heavily), or the full
// artist–title for a single. Take that when present; otherwise clean the whole title. A
// clean title with no track-number marker is returned (cleaned) unchanged. This is the
// mirror of the search side, which keeps the part BEFORE the number to identify the release.
// A trailing "(Original Mix)"/"(Original)" is dropped: it's the file's label for the default
// version, which catalogs routinely omit (a bare "Timewarp"), so keeping it would penalise
// the real track ("acid (original mix)" vs a release's "Acid") below the suggestion bar. A
// release that DOES spell "(Original Mix)" still matches strongly, and meaningful mixes
// (Extended, Dub, Club, Acapella, Radio…) stay intact so they keep disambiguating versions.
const ORIGINAL_SUFFIX = /\s*\((?:the\s+)?original(?:\s+(?:mix|version|edit|cut))?\)\s*$/i

// Drops a trailing "(Original Mix)"/"(Original)" marker — the file's name for the default
// version, which catalogs omit. Used both by the matcher (so a bare release track scores)
// and by the search (so the query that bare title resolves leads). A meaningful mix
// (Extended, Dub, Club, Acapella, Radio…) is left intact, and a title that is *only* the
// marker isn't stripped to nothing.
export function dropOriginalMarker(s: string): string {
  return squeeze(s.replace(ORIGINAL_SUFFIX, '')) || s
}

export function cleanMatchTitle(title: string): string {
  const afterTrackNumber = title.match(/\s-\s\d{1,3}\s+(.+)$/)
  return dropOriginalMarker(cleanQuery(afterTrackNumber ? afterTrackNumber[1] : title))
}
