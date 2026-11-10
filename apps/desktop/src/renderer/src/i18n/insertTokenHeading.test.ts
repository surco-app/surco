import { expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

it('heads the rename field groups as a title, not a sentence that trails off into a colon', () => {
  const headings = [es, en, de, fr, ja, ptBR].map((l) => l.settings.insertToken)
  expect(headings.filter((h) => /[:：]\s*$/.test(h))).toEqual([])
})
