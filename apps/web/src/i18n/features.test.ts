import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

type Item = { t: string; s?: string; d: string }

const LOCALES = [
  ['es', es, 100],
  ['en', en, 100],
  ['de', de, 110],
  ['fr', fr, 110],
  ['pt-BR', ptBR, 100],
  ['ja', ja, 50],
] as const

const items = (locale: { features: { groups: { items: Item[] }[] } }) =>
  locale.features.groups.flatMap((g) => g.items)

describe('features page stays skimmable', () => {
  it.each(LOCALES)('%s gives every feature a one-line summary', (_, locale, max) => {
    for (const item of items(locale)) {
      expect(item.s, item.t).toBeTruthy()
      expect(item.s?.length ?? 0, `${item.t}: ${item.s}`).toBeLessThanOrEqual(max)
    }
  })

  it.each(LOCALES)('%s keeps the summary to a single sentence', (_, locale) => {
    for (const item of items(locale)) {
      expect(item.s ?? '', item.t).not.toMatch(/[.!?]\s+\p{Lu}|。./u)
    }
  })

  it.each(LOCALES)('%s splits the page into six blocks a reader can jump between', (_, locale) => {
    expect(locale.features.groups).toHaveLength(6)
  })
})
