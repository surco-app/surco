import { describe, expect, it } from 'vitest'
import { entryOf } from '../lib/settingsTabs'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import itIT from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR, ca, it: itIT }

describe('the hint on the file-name button names the place the pattern really lives', () => {
  it('lives in the sidebar row that joins the naming tab', () => {
    expect(entryOf('naming').id).toBe('naming')
  })

  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`walks from the ${strings.settings.entries.naming} row to ${strings.settings.tabs.naming} in ${lang}`, () => {
      const { entries, tabs } = strings.settings
      expect(strings.editor.regenerateHint).toContain(`→ ${entries.naming} → ${tabs.naming}`)
    })
  }
})

describe('the messages that send you to the Output tab name the Files row that holds it', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`walks from the ${strings.settings.entries.naming} row to ${strings.settings.tabs.destination} in ${lang}`, () => {
      const { entries, tabs } = strings.settings
      for (const message of [strings.editor.overwriteLossyHint, strings.help.items.appleMusic.a]) {
        expect(message, message).toContain(`→ ${entries.naming} → ${tabs.destination}`)
      }
    })
  }
})

describe('the Discogs token answer', () => {
  // The answer said plain "No" while the toolbar's auto-match refuses to run without a token,
  // so each language must keep a sentence that says the whole-list match needs one.
  const AUTO_MATCH_SENTENCE = {
    ca: 'Aparellar automàticament tota la llista sí que necessita el teu propi token.',
    de: 'Das automatische Abgleichen der ganzen Liste braucht dagegen deinen eigenen Token.',
    en: 'Auto-matching the whole list does need your own token.',
    es: 'Emparejar automáticamente toda la lista sí necesita tu propio token.',
    fr: 'Auto-associer toute la liste, en revanche, nécessite ton propre token.',
    it: "L'abbinamento automatico dell'intera lista, invece, richiede il tuo token personale.",
    ja: 'リスト全体の自動マッチには、自分のトークンが必要です。',
    'pt-BR': 'Já associar automaticamente toda a lista precisa do seu próprio token.',
  }
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`says in ${lang} that matching the whole list needs your own token`, () => {
      expect(strings.help.items.token.a).toContain(
        AUTO_MATCH_SENTENCE[lang as keyof typeof AUTO_MATCH_SENTENCE],
      )
    })
    it(`sends you to the ${strings.settings.tabs.search} tab in ${lang}`, () => {
      expect(strings.help.items.token.a).toContain(`→ ${strings.settings.tabs.search}`)
    })
    it(`has no explanatory colon or em dash in ${lang}`, () => {
      expect(strings.help.items.token.a).not.toMatch(/[:：—]/)
    })
  }
})
