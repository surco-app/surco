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

// DJ-pool / label rips often prefix the file name with a catalog/label code ("BL2-045
// Artist - Title", "SRC001 Artist - Title") that, folded into the free-text query, breaks
// search: the specific candidate returns nothing and the bare code then matches dozens of
// unrelated catalogs (Bandcamp's autocomplete especially). Drop a LEADING code — 2-4 letters,
// an optional inner digit, an optional hyphen, then 2+ digits — only when more text follows
// (so the standalone catalog candidate keeps it). The shape is tight on purpose so it can't
// eat a numeric act name: "U2"/"M83" (one letter), "808 State" (digit-led), "Blink-182"/
// "Apollo 440" (5+ letters), "Sum 41" (space before the digits) all fall outside it.
const LEADING_CATALOG = /^[A-Za-z]{2,4}\d{0,2}-?\d{2,}\s+/
export function dropLeadingCatalog(query: string): string {
  return squeeze(query.replace(LEADING_CATALOG, '')) || query
}

export function cleanQuery(query: string): string {
  let out = query
  for (const re of NOISE) out = out.replace(re, ' ')
  return dropLeadingCatalog(squeeze(out))
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
// first " - NN " — a 1-3 digit track number, never a 4-digit year — onward, but only when
// the prefix is itself a full "A - B" query: a title can legitimately start with a number
// ("Nena - 99 Luftballons"), and cutting that to the bare artist returns plenty of noise
// that — since the candidate loop keeps the first non-empty result — would mask the real
// title forever. Leaves a string with no such marker unchanged, so it only ever helps.
export function dropTrackNumberTail(query: string): string {
  const m = query.match(/\s-\s\d{1,3}(?:\s.*)?$/)
  if (m?.index === undefined) return squeeze(query)
  const prefix = squeeze(query.slice(0, m.index))
  return prefix.includes(' - ') ? prefix : squeeze(query)
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

// Generic "version-type" words: on their own they name no specific remix, so a parenthetical
// built only from these plus words the title already contains ("Sunshine (Sunshine Version)")
// is a self-referential echo, not a disambiguating mix.
const VERSION_WORDS = new Set(['version', 'versions', 'mix', 'edit', 'remix'])

// Drops a trailing "(…)" that merely echoes the title — every word in it is either already in
// the part before it or a generic version word, and at least one is a real title echo. Such a
// label ("Sunshine (Sunshine Version)") just repeats the song name and drags free-text search
// onto unrelated compilations, while the bare title finds the single. A parenthetical that
// names a real remixer ("Love (Love To Infinity Mix)") or a meaningful mix ("(Euro Mix)") is
// NOT a pure echo and is left intact so it can still find the remix's own release.
export function dropEchoedVersion(s: string): string {
  const m = s.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return s
  const baseWords = new Set(squeeze(m[1]).toLowerCase().split(/\s+/).filter(Boolean))
  const inner = squeeze(m[2]).toLowerCase().split(/\s+/).filter(Boolean)
  if (inner.length === 0) return s
  const echoesTitle = inner.some((w) => baseWords.has(w))
  const allCovered = inner.every((w) => baseWords.has(w) || VERSION_WORDS.has(w))
  return echoesTitle && allCovered ? squeeze(m[1]) : s
}

export function cleanMatchTitle(title: string): string {
  const afterTrackNumber = title.match(/\s-\s\d{1,3}\s+(.+)$/)
  return dropOriginalMarker(cleanQuery(afterTrackNumber ? afterTrackNumber[1] : title))
}
