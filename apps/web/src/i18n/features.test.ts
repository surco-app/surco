import { describe, expect, it } from 'vitest'
import appCa from '../../../desktop/src/renderer/src/i18n/locales/ca.json'
import appDe from '../../../desktop/src/renderer/src/i18n/locales/de.json'
import appEn from '../../../desktop/src/renderer/src/i18n/locales/en.json'
import appEs from '../../../desktop/src/renderer/src/i18n/locales/es.json'
import appFr from '../../../desktop/src/renderer/src/i18n/locales/fr.json'
import appJa from '../../../desktop/src/renderer/src/i18n/locales/ja.json'
import appPtBR from '../../../desktop/src/renderer/src/i18n/locales/pt-BR.json'
import ca from './locales/ca.json'
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
  ['ca', ca, 110],
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

describe('features page names what the app shows', () => {
  it.each([
    ['es', es, appEs],
    ['en', en, appEn],
    ['de', de, appDe],
    ['fr', fr, appFr],
    ['pt-BR', ptBR, appPtBR],
    ['ja', ja, appJa],
    ['ca', ca, appCa],
  ] as const)(
    '%s lists the off-grid cue filter under the name the filter menu uses',
    (_, locale, app) => {
      expect(items(locale).map((item) => item.t)).toContain(app.sidebar.filter.offGrid)
    },
  )

  it.each([
    ['es', es, appEs],
    ['en', en, appEn],
    ['de', de, appDe],
    ['fr', fr, appFr],
    ['pt-BR', ptBR, appPtBR],
    ['ja', ja, appJa],
    ['ca', ca, appCa],
  ] as const)(
    '%s points the guide reader preparing cues at the off-grid filter by its app name',
    (_, locale, app) => {
      const cues = locale.guide.sections.find((s) => s.id === 'rekordbox')
      expect(cues?.points.join(' ')).toContain(app.sidebar.filter.offGrid)
    },
  )
})
