import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

type Summarised = { title: string; s?: string }

const LOCALES = [
  ['es', es, 110],
  ['en', en, 110],
  ['de', de, 120],
  ['fr', fr, 120],
  ['pt-BR', ptBR, 110],
  ['ja', ja, 60],
] as const

const lists = (locale: (typeof LOCALES)[number][1]) => ({
  'use case': locale.useCases.cases as Summarised[],
})

describe('one-line summaries that are never cut mid-sentence', () => {
  it.each(LOCALES)('%s gives every use case a short line', (_, locale, max) => {
    for (const [kind, items] of Object.entries(lists(locale))) {
      for (const item of items) {
        expect(item.s, `${kind}: ${item.title}`).toBeTruthy()
        expect(item.s?.length ?? 0, `${kind}: ${item.s}`).toBeLessThanOrEqual(max)
        expect(item.s ?? '', `${kind}: ${item.title}`).not.toMatch(/[.!?]\s+\p{Lu}|。./u)
      }
    }
  })
})
