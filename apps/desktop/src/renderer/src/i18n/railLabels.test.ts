import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR, ca }

const columns = (text: string): number =>
  [...text].reduce((sum, ch) => sum + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0)

describe('the rail labels fit under their icons in every language, so none is cut to an ellipsis', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`keeps the ${lang} rail labels as short as «rekordbox»`, () => {
      for (const label of [strings.sources.workingList, strings.copies.rail])
        expect(columns(label), label).toBeLessThanOrEqual(columns('rekordbox'))
    })
  }
})
