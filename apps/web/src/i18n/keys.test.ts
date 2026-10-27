import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'
import ja from './locales/ja.json'

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
  it('es, en and ja expose the exact same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort())
    expect(keys(ja).sort()).toEqual(keys(en).sort())
  })

  it('declares Japanese document and structured-data language', () => {
    expect(ja.meta.htmlLang).toBe('ja')
    expect(ja.meta.ogLocale).toBe('ja_JP')
    expect(ja.meta.inLanguage).toBe('ja')
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
    for (const locale of [es, ja]) {
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
  for (const [name, locale] of [
    ['en', en],
    ['es', es],
    ['ja', ja],
  ] as const) {
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

  it('gives every language the same walkthrough steps', () => {
    expect(shots(en)).toHaveLength(shots(es).length)
    expect(shots(en)).toHaveLength(shots(ja).length)
    expect(ja.guide.sections.map((section) => section.id)).toEqual(
      en.guide.sections.map((section) => section.id),
    )
  })
})
