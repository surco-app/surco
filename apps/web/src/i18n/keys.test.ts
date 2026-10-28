import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const TRANSLATIONS = [
  ['es', es],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
  ['ja', ja],
] as const

// Every visible string is keyed; a missing key silently falls back to the other
// language and ships an untranslated page. Flattening both trees and comparing
// the key sets catches that before it reaches a build.
function keys(obj: unknown, prefix = ''): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => keys(item, `${prefix}[${i}]`))
  }
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
  }
  return [prefix]
}

describe('locale parity', () => {
  it.each(TRANSLATIONS)('%s exposes the exact same keys as en', (_, locale) => {
    expect(keys(locale).sort()).toEqual(keys(en).sort())
  })

  // Search engines and screen readers take the page's language from these, not from
  // the text: a German page declaring itself English is indexed and read as English.
  it.each([
    ['de', de, 'de_DE'],
    ['fr', fr, 'fr_FR'],
    ['pt-BR', ptBR, 'pt_BR'],
    ['ja', ja, 'ja_JP'],
  ] as const)('declares %s as the document and structured-data language', (lang, locale, og) => {
    expect(locale.meta.htmlLang).toBe(lang)
    expect(locale.meta.ogLocale).toBe(og)
    expect(locale.meta.inLanguage).toBe(lang)
  })

  it('keeps interpolation placeholders aligned in every language', () => {
    const placeholders = (value: unknown): string[] =>
      typeof value === 'string'
        ? [...value.matchAll(/\{\{\s*([^,}\s]+)[^}]*\}\}/g)].map((match) => match[1]).sort()
        : Array.isArray(value)
          ? value.flatMap(placeholders)
          : value && typeof value === 'object'
            ? Object.values(value).flatMap(placeholders)
            : []
    for (const [, locale] of TRANSLATIONS) {
      const visit = (reference: unknown, translation: unknown, path = ''): void => {
        if (typeof reference === 'string') {
          expect(placeholders(translation), path).toEqual(placeholders(reference))
        } else if (Array.isArray(reference)) {
          reference.forEach((entry, index) => {
            visit(entry, (translation as unknown[])[index], `${path}[${index}]`)
          })
        } else if (reference && typeof reference === 'object') {
          for (const [key, value] of Object.entries(reference)) {
            visit(
              value,
              (translation as Record<string, unknown>)[key],
              path ? `${path}.${key}` : key,
            )
          }
        }
      }
      visit(en, locale)
    }
  })
})

// The guide names its screenshots by filename, so a rename or a re-export in another
// format leaves the copy pointing at a file that is no longer there. The page degrades
// to a caption-only placeholder instead of erroring, which means a broken shot ships
// quietly — the whole point of the walkthrough is the picture next to the step.
function shots(locale: unknown): string[] {
  const sections = (locale as { guide?: { sections?: { shot?: string }[] } }).guide?.sections ?? []
  return sections.map((s) => s.shot).filter((s): s is string => Boolean(s))
}

describe('guide screenshots', () => {
  for (const [name, locale] of [['en', en], ...TRANSLATIONS] as const) {
    it(`${name} references only files that exist in public/guide`, () => {
      const missing = shots(locale).filter(
        (shot) =>
          !existsSync(fileURLToPath(new URL(`../../public/guide/${shot}`, import.meta.url))),
      )
      expect(missing).toEqual([])
    })

    // The walkthrough tells the reader which button to press by the name on it, so the
    // screen beside the text must show the app in the reader's language.
    it(`${name} shows every step in its own language`, () => {
      expect(shots(locale).length).toBeGreaterThan(0)
      expect(shots(locale).filter((shot) => !shot.endsWith(`-${name}.webp`))).toEqual([])
    })
  }

  it.each(TRANSLATIONS)('gives %s the same walkthrough steps as en', (_, locale) => {
    expect(shots(locale)).toHaveLength(shots(en).length)
    expect(locale.guide.sections.map((section) => section.id)).toEqual(
      en.guide.sections.map((section) => section.id),
    )
  })
})
