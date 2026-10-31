import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ptBR from './locales/pt-BR.json'

const READS = {
  es: [es, 'si no hay otro cue en ese compás'],
  en: [en, 'if there is no other cue in that bar'],
  de: [de, 'wenn in diesem Takt keine andere Cue liegt'],
  fr: [fr, 'si aucune autre cue ne tombe sur cette mesure'],
  'pt-BR': [ptBR, 'se não houver outra cue nesse compasso'],
} as const

describe('the clear rule condition', () => {
  it.each(Object.entries(READS))(
    'says in %s that the bar must hold no other cue, not that it fits another rule',
    (_, [locale, text]) => {
      expect(locale.settings.cueFlows.when.clear).toBe(text)
    },
  )
})
