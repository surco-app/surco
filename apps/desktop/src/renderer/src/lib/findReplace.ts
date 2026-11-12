import type { MetaTextKey, TrackMetadata } from '../../../shared/types'

// The free-text tags find/replace runs over — where bulk cleanup of rips actually happens.
// Pure-numeric fields (year, track/disc number, bpm) are left out so a search like "0" can't
// mangle them.
const FIND_REPLACE_FIELDS: MetaTextKey[] = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'grouping',
  'comment',
  'key',
  'publisher',
  'catalogNumber',
  'remixArtist',
]

interface FindReplaceOptions {
  regex?: boolean
  caseSensitive?: boolean
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isValidRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}

// Replaces every occurrence of `find` in `value`. Plain mode matches literal text and treats
// `replace` literally (a "$" stays a "$"); regex mode compiles `find` as a pattern and lets
// `replace` use $1 capture groups. An empty find or an invalid regex leaves the value as is.
export function compileFindReplace(
  find: string,
  replace: string,
  opts: FindReplaceOptions = {},
): (value: string) => string {
  if (!find) return (value) => value
  const flags = `g${opts.caseSensitive ? '' : 'i'}`
  if (opts.regex) {
    if (!isValidRegex(find)) return (value) => value
    const pattern = new RegExp(find, flags)
    return (value) => value.replace(pattern, replace)
  }
  const pattern = new RegExp(escapeRegex(find), flags)
  return (value) => value.replace(pattern, () => replace)
}

export function replaceInValue(
  value: string,
  find: string,
  replace: string,
  opts: FindReplaceOptions = {},
): string {
  return compileFindReplace(find, replace, opts)(value)
}

// Applies the replacement across a track's text fields, returning only the fields that
// actually changed — so the caller can merge, count and preview without overwriting tags the
// search never touched.
export function findReplaceTrack(
  meta: TrackMetadata,
  replaceIn: (value: string) => string,
): Partial<TrackMetadata> {
  const out: Partial<TrackMetadata> = {}
  for (const field of FIND_REPLACE_FIELDS) {
    const next = replaceIn(meta[field] ?? '')
    if (next !== meta[field]) out[field] = next
  }
  const custom = meta.custom ?? {}
  const changed = Object.entries(custom).flatMap(([key, value]) => {
    const next = replaceIn(value)
    return next === value ? [] : [[key, next] as const]
  })
  if (changed.length > 0) out.custom = { ...custom, ...Object.fromEntries(changed) }
  return out
}
