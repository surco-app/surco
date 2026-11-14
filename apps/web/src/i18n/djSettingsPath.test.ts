import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import itIT from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR, ca, it: itIT }

const OUTPUT_TAB: Record<string, string> = {
  de: 'Ausgabe',
  en: 'Output',
  es: 'Destino',
  fr: 'Sortie',
  ja: '出力',
  'pt-BR': 'Saída',
  ca: 'Destinació',
  it: 'Destinazione',
}

const strings = (node: unknown): string[] =>
  typeof node === 'string'
    ? [node]
    : node && typeof node === 'object'
      ? Object.values(node).flatMap(strings)
      : []

describe('the site sends DJs to the tab where Engine DJ and Traktor are set up', () => {
  for (const [lang, locale] of Object.entries(LOCALES)) {
    it(`never points Engine DJ or Traktor to ${OUTPUT_TAB[lang]} in ${lang}`, () => {
      const wrong = strings(locale).filter(
        (text) => /Engine DJ|Traktor/.test(text) && text.includes(`→ ${OUTPUT_TAB[lang]}`),
      )
      expect(wrong).toEqual([])
    })
  }
})
