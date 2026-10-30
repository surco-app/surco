import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR }
const LIBRARIES = ['rekordbox', 'engine', 'traktor'] as const

describe('the Playlists field labels', () => {
  // Three rows all labelled "Playlists" told apart only by a 12px glyph: the form has one
  // per DJ program, so each label says which program the playlists belong to.
  it.each(Object.entries(LOCALES))('name their program in %s', (_, locale) => {
    for (const library of LIBRARIES) {
      expect(locale.fields[`${library}Playlists`]).toContain(locale.sources[library])
    }
  })
})
