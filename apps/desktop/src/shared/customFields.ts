import { METADATA_KEYS } from './metadata'
import { MANAGED_ALIASES, TAG_FIELDS } from './tagFields'
import type { CustomField, ForeignTag, TrackMetadata } from './types'

// The tag a custom field is written under: its key upper-cased, the convention mp3tag and
// TagScanner follow for fields of their own. A file tagged elsewhere with any casing still
// reads back, since the reader compares names case-insensitively.
export function customTagName(key: string): string {
  return key.toUpperCase()
}

// A key in the shape Surco's own keys have (catalogNumber), from the name the user gave
// the field: accents and symbols dropped, words joined in camelCase, never led by a digit.
export function suggestCustomKey(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  const key = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('')
  return /^[0-9]/.test(key) ? `field${key[0].toUpperCase()}${key.slice(1)}` : key
}

export type CustomKeyProblem = 'invalid' | 'taken'

// A tag name every container accepts: Vorbis allows no spaces or '=', and a key leading
// with a letter reads as a {token} in a filename pattern.
const VALID_KEY = /^[A-Za-z][A-Za-z0-9_]*$/

// Every name a managed field is read from or written to, lower-cased: a custom field on
// one of them would be read as that field and never reach the editor as its own.
const TAKEN = new Set(
  [
    ...METADATA_KEYS,
    ...MANAGED_ALIASES,
    ...TAG_FIELDS.flatMap((f) => [f.id3 ?? '', f.vorbis ?? '', ...(f.vorbisAlso ?? [])]),
    'encoder',
  ]
    .filter(Boolean)
    .map((name) => name.toLowerCase()),
)

export function customKeyProblem(
  key: string,
  existing: readonly CustomField[],
): CustomKeyProblem | null {
  if (!VALID_KEY.test(key)) return 'invalid'
  const lower = key.toLowerCase()
  if (TAKEN.has(lower) || existing.some((f) => f.key.toLowerCase() === lower)) return 'taken'
  return null
}

export function isCustomTag(name: string, fields: readonly CustomField[]): boolean {
  const upper = name.toUpperCase()
  return fields.some((f) => customTagName(f.key) === upper)
}

export function customValues(
  meta: TrackMetadata,
  foreignTags: readonly ForeignTag[],
  fields: readonly CustomField[],
): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of fields) {
    const edited = meta.custom?.[field.key]
    const tag = customTagName(field.key)
    values[field.key] = edited ?? foreignTags.find((t) => t.name.toUpperCase() === tag)?.value ?? ''
  }
  return values
}

// What a conversion job carries for the user's own fields: every field's value, so a
// conversion into another container keeps them too, and the tags that spell a field's
// name another way ("VinylCondition"), cleared so the file does not hold it twice.
export function customJob(
  meta: TrackMetadata,
  foreignTags: readonly ForeignTag[],
  foreignRemoved: readonly string[],
  fields: readonly CustomField[],
): { custom: Record<string, string>; strayTags: string[] } {
  const live = foreignTags.filter((t) => !foreignRemoved.includes(t.name))
  const strayTags = live
    .filter((t) => isCustomTag(t.name, fields) && t.name !== t.name.toUpperCase())
    .map((t) => t.name)
  return { custom: customValues(meta, live, fields), strayTags }
}
