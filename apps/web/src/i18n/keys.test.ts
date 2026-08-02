import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import en from './locales/en.json'
import es from './locales/es.json'

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
  it('es and en expose the exact same keys', () => {
    expect(keys(en).sort()).toEqual(keys(es).sort())
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
  ] as const) {
    it(`${name} references only files that exist in public/guide`, () => {
      const missing = shots(locale).filter(
        (shot) => !existsSync(fileURLToPath(new URL(`../../public/guide/${shot}`, import.meta.url))),
      )
      expect(missing).toEqual([])
    })
  }

  it('ships a screenshot for every step of both walkthroughs', () => {
    expect(shots(en).length).toBeGreaterThan(0)
    expect(shots(en)).toHaveLength(shots(es).length)
  })
})
