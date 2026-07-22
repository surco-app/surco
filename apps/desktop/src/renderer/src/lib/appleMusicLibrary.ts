import type { AppleMusicLookupCandidate } from '../../../shared/types'
import { foldText } from './normalizeText'
import { cleanName, durationProximitySec } from './release'

// One library track, narrowed to what the matcher scores against. The artist is pre-folded
// at index time (foldArtist) so each lookup is a cheap word-set compare; parts is the raw
// title's base+version-suffix split for version-aware scoring; durationSec is its length when
// Music reported one, used to tell two versions of a title apart. persistentId names the
// Music row so a matched old copy can be acted on (the replace flow deletes it), not just
// detected; absent on Engine DJ rows and old-shape dumps.
interface LibraryEntry {
  artist: string
  durationSec?: number
  parts: { base: string; suffix: string }
  persistentId?: string
  // The row's raw "Artist - Title" as Music displays it, untouched by folding. The
  // stale-copy confirm dialog shows it so the user can verify WHICH entry the scored
  // match picked before anything is deleted.
  label: string
}

// A snapshot of the user's Apple Music library, keyed by canonical title so a track's
// "do I already own this?" check scores only the handful of entries sharing a title key
// instead of scanning the whole library (or spawning an osascript per track).
export type AppleMusicIndex = Map<string, LibraryEntry[]>

// How close a candidate must score to a library entry to count as already owned. Tuned so
// an exact title+artist clears it comfortably, a wrong artist or a different base title
// falls well short, and two different versions of one title (same base, distinct suffixes,
// far-apart durations) land just under it. See libraryMatchScore.
const LIBRARY_MATCH_THRESHOLD = 0.7

// Weights for the three library signals, renormalised over whichever are present (duration
// is absent when either side lacks one). Artist is a near-gate: a wrong artist alone can't
// clear the threshold. Title carries the most; duration is only a separator between
// otherwise-equal versions, so it gets the smallest share.
const LIBRARY_WEIGHTS = { title: 0.45, artist: 0.4, duration: 0.15 }

// Collaborator separators, matched on the raw artist string (the split happens before
// folding, which would turn a comma/ampersand into a space and lose the boundary): a comma
// or ampersand joining co-artists, an inline feature clause, or a "presents"/"pres." credit.
// Our tags join collaborators ("Alfredo Pareja, Saint Etien", "Head Horny's & DJ Miguel
// Serna", "Head Horny's presents Miguel Serna") while Apple Music files the track under just
// the lead — often spelled shorter ("Head Horny's & Miguel Serna"), so requiring every
// co-artist's word to appear would read the collaboration as not-owned. "presents" is a
// separator and not just trailing noise because the lone word sits between two real names,
// so neither side is a subset of the other unless we cut on it.
const COLLAB_SEP = /\s*[,&]\s*|\s+(?:feat\.?|featuring|ft\.?|presents|pres\.?)\s+/i

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

// A leading DJ/Dr./MC handle or a "The" article (folded to a bare word) — noise around the
// same act ("The Untidy DJs" is the library's "Untidy DJ's"). The trailing space in the
// pattern means a lone "dj"/"mc"/"the" artist is never stripped to nothing.
const HANDLE_PREFIX = /^(?:(?:dj|dr|mc|the) )+/

// Folds an artist into a canonical word set for matching:
//  - collapse a run of two or more single letters into one word, so a dotted acronym
//    ("DJ F.R.A.N.K." → "dj f r a n k") meets its solid spelling ("DJ. Frank" → "dj frank");
//    a lone trailing initial ("Ricardo F") isn't a run and stays its own word;
//  - split a letter/digit boundary so a joined "A7" reads as "a 7";
//  - turn a spelled-out small number into its digit, so "A Seven" matches "A7";
//  - split a glued leading "Dj" off the name ("Djmofly" → "dj mofly"), so the handle strip
//    below sees it and the glued spelling meets the spaced tag ("DJ Mofly"). Only "dj" is
//    split this way: real names starting with "dr"/"mc"/"the" are everywhere (Drake,
//    McCoy, Therese) while a leading "dj" is almost always the handle — and a genuine
//    Django folds the same on both sides, so it still matches itself. The 2+ letter
//    lookahead keeps a bare "DJS" a word instead of cutting it to "s";
//  - drop a leading DJ/Dr./MC handle or "The" article, so "DJ Raúl Soto" meets the library's
//    "Raul Soto" and "The Untidy DJs" meets "Untidy DJ's".
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
    .replace(/^dj(?=[a-z]{2,})/, 'dj ')
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
// the title as "Artist – Title" ("Debby – Maybe…"); keying off all these lets the lookup
// gather the right entries to score and stay consistent with the editor's badge. Variants
// are kept in a Set so an unchanged one (no suffix, no prefix) isn't duplicated.
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

// The buckets a track is filed and looked up under: its title keys, plus the last word of its
// base title. The last-word bucket is what lets a library row stored under a short title
// ("funky feelings") meet a candidate whose title field is the whole release path
// ("… - 04 Funky Feelings (Klubb Mix)") — they share the final word, so the entry is gathered
// and the scorer's whole-word tail check (baseTitlesMatch) confirms or rejects it. A common
// last word over-gathers a little, but the score (artist + version) throws out false hits.
function bucketKeys(title: string, artist: string): string[] {
  const keys = new Set(titleKeys(title, artist))
  const base = titleParts(title, artist).base
  const lastWord = base.split(' ').at(-1)
  if (lastWord) keys.add(lastWord)
  return [...keys]
}

// A title split for version-aware scoring: the folded base (suffix stripped, and a leading
// copy of the artist removed for "Artist – Title" tags) and the folded version suffix on its
// own ('' when the title carried none). Two titles are the same cut when their bases match
// and they don't name two *different* versions.
function titleParts(title: string, artist: string): { base: string; suffix: string } {
  const folded = foldText(artist)
  let base = foldText(title.replace(VERSION_SUFFIX, ''))
  if (folded && base.startsWith(`${folded} `)) base = base.slice(folded.length + 1)
  const suffixRaw = title.match(VERSION_SUFFIX)?.[0] ?? ''
  return { base, suffix: foldText(suffixRaw) }
}

// Whether one folded base title is the same song as another: equal, or one is a trailing
// whole-word run of the other ("funky feelings" is the tail of "… 04 funky feelings", the
// full-filename title field). Whole words via space-padding, so "feelings" never matches
// inside "feelingsx".
function baseTitlesMatch(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return long === short || long.endsWith(` ${short}`)
}

// The title signal, 0..1. 0 when the bases are different songs. 1 when the bases match and
// the versions agree — including when either side names no version (a base-only tag vs a
// versioned library copy is the same cut). 0.6 when the bases match but each names a
// *different* version: not enough to own on title alone, so the duration separator and the
// threshold decide (two distinct remixes with far-apart lengths fall through; the same remix
// with a drifted length is rescued by the duration score).
function titleScore(
  candidate: { base: string; suffix: string },
  entry: { base: string; suffix: string },
): number {
  if (!baseTitlesMatch(candidate.base, entry.base)) return 0
  if (candidate.suffix && entry.suffix && candidate.suffix !== entry.suffix) return 0.6
  return 1
}

export function buildLibraryIndex(tracks: AppleMusicLookupCandidate[]): AppleMusicIndex {
  const index: AppleMusicIndex = new Map()
  for (const { title, artist, durationSec, persistentId } of tracks) {
    const folded = foldArtist(artist)
    // An empty artist can't identify a song and would later word-match nothing
    // meaningfully; skip the row entirely.
    if (!folded) continue
    // One shared entry filed under each of its title keys, so a candidate keyed any of the
    // ways still gathers this exact row (deduped by reference at lookup). parts holds the
    // raw-title base+suffix split for version-aware scoring (the folded keys have lost the
    // parens, so the suffix must be captured here from the original title).
    const entry: LibraryEntry = {
      artist: folded,
      durationSec,
      parts: titleParts(title, artist),
      persistentId,
      label: `${artist} - ${title}`,
    }
    for (const key of bucketKeys(title, artist)) {
      if (!key) continue
      const list = index.get(key)
      if (list) list.push(entry)
      else index.set(key, [entry])
    }
  }
  return index
}

// Whether the candidate's primary artist and a (pre-folded) library artist are the same act:
// one's words wholly contained in the other's, either direction. The library copy is often
// the shorter spelling (the tag adds a "Dr." prefix, an "On A Vinyl" descriptor, a "presents"
// credit), while sometimes it carries the extra words (a "& Friends" suffix). Whole-word both
// ways, so a partial name ("Mat") never matches a longer one ("Matador"). As a fallback, the
// same name spelled with and without internal spaces ("DSigual" vs "D Sigual") is one act —
// a rip glued a leading initial onto the next word; compare with all spaces removed. That only
// erases word boundaries, never letters, so it still can't fuse "Mat" with "Matador".
function artistMatch(candidatePrimaryWords: string[], entryFoldedArtist: string): boolean {
  const candidateSet = new Set(candidatePrimaryWords)
  const libraryWords = entryFoldedArtist.split(' ')
  const librarySet = new Set(libraryWords)
  return (
    candidatePrimaryWords.every((w) => librarySet.has(w)) ||
    libraryWords.every((w) => candidateSet.has(w)) ||
    candidatePrimaryWords.join('') === libraryWords.join('')
  )
}

// Scores how strongly a library entry is the same track as the candidate, 0..1: title
// (version-aware), artist (a near-gate, binary), and — when both sides carry a length —
// duration proximity to separate same-base different-version cuts. Weights renormalise over
// the signals present, so a missing duration just leaves title+artist deciding.
function libraryMatchScore(
  entry: LibraryEntry,
  candidate: {
    parts: { base: string; suffix: string }
    primaryWords: string[]
    durationSec?: number
  },
): number {
  const title = titleScore(candidate.parts, entry.parts)
  if (title === 0) return 0
  const artist = artistMatch(candidate.primaryWords, entry.artist) ? 1 : 0
  let weighted = LIBRARY_WEIGHTS.title * title + LIBRARY_WEIGHTS.artist * artist
  let total = LIBRARY_WEIGHTS.title + LIBRARY_WEIGHTS.artist
  if (candidate.durationSec !== undefined && entry.durationSec !== undefined) {
    weighted +=
      LIBRARY_WEIGHTS.duration * durationProximitySec(candidate.durationSec, entry.durationSec)
    total += LIBRARY_WEIGHTS.duration
  }
  return weighted / total
}

// The candidate's scoring shape plus the library entries plausible enough to score against
// it: the entries filed under any of its title keys, deduped by reference (one row is filed
// under several keys). Null when the tags can't identify a song at all.
function candidateEntries(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string; durationSec?: number },
): {
  cand: { parts: { base: string; suffix: string }; primaryWords: string[]; durationSec?: number }
  entries: Set<LibraryEntry>
} | null {
  const primary = primaryArtist(candidate.artist)
  if (!primary) return null
  const parts = titleParts(candidate.title, candidate.artist)
  if (!parts.base) return null
  const cand = { parts, primaryWords: primary.split(' '), durationSec: candidate.durationSec }
  const entries = new Set<LibraryEntry>()
  for (const key of bucketKeys(candidate.title, candidate.artist)) {
    for (const entry of index.get(key) ?? []) entries.add(entry)
  }
  return { cand, entries }
}

// Whether the candidate (a track's live tags) is already in the library: it scores at least
// LIBRARY_MATCH_THRESHOLD against some library entry sharing a title key. Bucketed by title
// key so only the handful of plausible entries are scored, never the whole library. It's a
// hint, not a guarantee.
export function isInLibrary(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string; durationSec?: number },
): boolean {
  const gathered = candidateEntries(index, candidate)
  if (!gathered) return false
  for (const entry of gathered.entries) {
    if (libraryMatchScore(entry, gathered.cand) >= LIBRARY_MATCH_THRESHOLD) return true
  }
  return false
}

// What the replace flow needs from the superseded copy: the persistent ID to delete it
// by, and its raw label so the confirm dialog can name it.
export interface StaleLibraryCopy {
  persistentId: string
  label: string
}

// The library copy the candidate supersedes: an entry that matches the same way
// isInLibrary does but is NOT the copy Surco itself added (currentId — before the
// snapshot refreshes only the old rip is in the index, after it both are, so the exclusion
// is what keeps the replace offer from pointing at the fresh copy). Entries with no ID
// (Engine DJ rows, old-shape dumps) can't be deleted, so they are never named. Same
// threshold as the badge: a different song is never offered for deletion.
export function staleLibraryCopy(
  index: AppleMusicIndex,
  candidate: { title: string; artist: string; durationSec?: number },
  currentId: string,
): StaleLibraryCopy | null {
  const gathered = candidateEntries(index, candidate)
  if (!gathered) return null
  for (const entry of gathered.entries) {
    if (
      entry.persistentId &&
      entry.persistentId !== currentId &&
      libraryMatchScore(entry, gathered.cand) >= LIBRARY_MATCH_THRESHOLD
    )
      return { persistentId: entry.persistentId, label: entry.label }
  }
  return null
}
