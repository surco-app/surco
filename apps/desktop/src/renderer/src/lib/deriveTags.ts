import type { TrackMetadata } from '../../../shared/types'
import { FIELD_DEFS } from './fields'

const TOKEN = /\{(\w+)\}/g
const META_KEYS = new Set<string>(FIELD_DEFS.map((d) => d.key))

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
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
    regex += '(.*?)'
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
