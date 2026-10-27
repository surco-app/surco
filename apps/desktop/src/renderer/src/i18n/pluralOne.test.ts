import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ptBR from './locales/pt-BR.json'

function leaves(obj: unknown, prefix = ''): [string, string][] {
  if (obj && typeof obj === 'object') {
    return Object.entries(obj).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k))
  }
  return typeof obj === 'string' ? [[prefix, obj]] : []
}

const LOCALES: [string, unknown][] = [
  ['en', en],
  ['es', es],
  ['de', de],
  ['fr', fr],
  ['pt-BR', ptBR],
]

// French and Brazilian Portuguese file 0 under "one", so i18next picks the _one string for a
// count of zero too. A _one string that spells the number as a literal 1 then tells the user
// "1 morceau" when there are none; it has to print {{count}} instead.
const ZERO_IS_ONE = LOCALES.filter(([lng]) => new Intl.PluralRules(lng).select(0) === 'one')

describe('_one strings in locales where zero is "one"', () => {
  it('covers French and Brazilian Portuguese', () => {
    expect(ZERO_IS_ONE.map(([lng]) => lng)).toEqual(['fr', 'pt-BR'])
  })

  it.each(ZERO_IS_ONE)('%s never hard-codes the number 1', (_, locale) => {
    const literal = leaves(locale)
      .filter(([key]) => key.endsWith('_one'))
      .filter(([, text]) => /(?<![\d.,])1(?![\d.,])/.test(text.replace(/\{\{[^}]*\}\}/g, '')))
      .map(([key]) => key)
    expect(literal).toEqual([])
  })
})
