import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ptBR from './locales/pt-BR.json'

// Every visible string is keyed; a missing key silently falls back to the other
// language and ships an untranslated UI. Flattening both trees and comparing the
// key sets catches that before it reaches a build.
function keys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => keys(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => leaves(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return typeof obj === 'string' ? [[prefix, obj]] : []
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort()
}

const LOCALES: [string, unknown][] = [
  ['es', es],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
]

describe('locale parity', () => {
  it.each(LOCALES)('%s exposes the exact same keys as en', (_, locale) => {
    expect(keys(locale).sort()).toEqual(keys(en).sort())
  })

  // A translation that drops or renames a {{placeholder}} renders the raw braces (or
  // nothing) at runtime; comparing per-key placeholder sets against English catches it.
  it.each(LOCALES)('%s keeps every interpolation placeholder en uses', (_, locale) => {
    const reference = new Map(leaves(en))
    for (const [key, text] of leaves(locale)) {
      const enText = reference.get(key)
      if (enText === undefined) continue
      expect({ key, ph: placeholders(text) }).toEqual({ key, ph: placeholders(enText) })
    }
  })
})
