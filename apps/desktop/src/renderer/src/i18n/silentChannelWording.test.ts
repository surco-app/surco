import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it_ from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const locales = { ca, de, en, es, fr, it: it_, ja, 'pt-BR': ptBR }

describe('editor.loudnessSilentLeft and loudnessSilentRight', () => {
  for (const [code, locale] of Object.entries(locales)) {
    for (const key of ['loudnessSilentLeft', 'loudnessSilentRight'] as const) {
      it(`${code} ${key} stays within 21 characters so the row keeps room for its label`, () => {
        expect(locale.editor[key].length).toBeLessThanOrEqual(21)
      })
    }
  }
})
