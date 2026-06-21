import type { TrackMetadata } from '../../../shared/types'
import { FIELD_DEFS } from './fields'

const TOKEN = /\{(\w+)\}/g
const META_KEYS = new Set<string>(FIELD_DEFS.map((d) => d.key))
// Numeric fields capture digits only, so "{trackNumber}. {artist}" never swallows a
// non-numbered name — which is what keeps the auto-detect below from misreading a plain
// "Artist - Title" as a track number.
const NUMERIC = new Set(['trackNumber', 'discNumber', 'bpm', 'year'])

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Only a known audio extension counts as one: callers hand over both raw file names
// and names already stripped, and treating any trailing ".something" as an extension
// would eat a dotted artist ("Acer vs. The Beeper - …").
function stripExt(name: string): string {
  return name.replace(/\.(wav|flac|aif|aiff|mp3|m4a|mp4|aac|ogg|oga|opus)$/i, '')
}

// The inverse of renderOutputName: read a file's name through a "{artist} - {title}"-style
// template (the same `{field}` tokens used for output naming) and return the tags it yields.
// Each token becomes a lazy capture group, so the literal text between tokens (". ", " - ")
// is what delimits them; the extension is dropped first. A token that captures nothing, or
// whose name isn't a real metadata field, is left out — so a non-match or a stray token never
// blanks an existing tag.
export function deriveTags(fileName: string, pattern: string): Partial<TrackMetadata> {
  const base = stripExt(fileName)
  const fields: string[] = []
  let regex = ''
  let last = 0
  for (const m of pattern.matchAll(TOKEN)) {
    regex += escapeRegex(pattern.slice(last, m.index))
    fields.push(m[1])
    regex += NUMERIC.has(m[1]) ? '(\\d+)' : '(.*?)'
    last = (m.index ?? 0) + m[0].length
  }
  regex += escapeRegex(pattern.slice(last))
  const match = base.match(new RegExp(`^${regex}$`))
  if (!match) return {}
  const out: Partial<TrackMetadata> = {}
  fields.forEach((field, i) => {
    const value = match[i + 1]?.trim()
    if (value && META_KEYS.has(field)) out[field as keyof TrackMetadata] = value
  })
  return out
}

// Patterns are tried most-specific first, so a leading track number is read when present
// ("104. Artist - Title", "07 - Artist - Title") and a plain "Artist - Title" still works.
// The digit-only track number means the numbered patterns simply don't match an unnumbered
// name, letting it fall through to the plain one.
const SMART_PATTERNS = [
  '{trackNumber}. {artist} - {title}',
  '{trackNumber} - {artist} - {title}',
  '{trackNumber} {artist} - {title}',
  '{artist} - {title}',
]

// The bare-space numbered shape ("04 Artist - Title") is the one that collides with a numeric
// artist name ("4 Strings", "808 State", "50 Cent"): both are a number, a space, then a word.
// A real track number in this form is zero-padded, and no artist name starts with a leading
// zero — so only a padded number is read as the track number here. The dot/dash forms stay
// unambiguous (no act is written "4. Strings" or "4 - Strings - …") and need no such guard.
const BARE_SPACE_NUMBERED = '{trackNumber} {artist} - {title}'
const ZERO_PADDED = /^0\d+$/

// Maps the separator styles real downloads use onto the " - " the patterns expect,
// without touching the ambiguous ones. "_-_" (and en/em dashes) are unmistakably the
// artist/title dash; bare underscores become spaces only when the name has none of its
// own, so a normal "Artist - Title" — or a title with an internal underscore — is left
// alone. A lone "-" or single "_" is deliberately not split: it can't be told apart
// from a hyphenated word.
function normalizeSeparators(name: string): string {
  let s = name.replace(/\s*_\s*-\s*_\s*/g, ' - ').replace(/\s*[–—]\s*/g, ' - ')
  if (s.includes('_') && !name.includes(' ')) s = s.replace(/_/g, ' ')
  return s
}

// One-click derivation that picks the matching common DJ-rip naming itself, so the user
// doesn't have to type a pattern for the usual cases.
export function smartDeriveTags(fileName: string): Partial<TrackMetadata> {
  const normalized = normalizeSeparators(fileName)
  for (const pattern of SMART_PATTERNS) {
    const tags = deriveTags(normalized, pattern)
    if (Object.keys(tags).length === 0) continue
    if (pattern === BARE_SPACE_NUMBERED && tags.trackNumber && !ZERO_PADDED.test(tags.trackNumber))
      continue
    return tags
  }
  return {}
}
