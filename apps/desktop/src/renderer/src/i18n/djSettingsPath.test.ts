import { describe, expect, it } from 'vitest'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const LOCALES = { de, en, es, fr, ja, 'pt-BR': ptBR }

describe('the messages that send you to the Traktor or Engine DJ settings name the tab they live in', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`points to ${strings.settings.tabs.programs} in ${lang}, not to ${strings.settings.tabs.destination}`, () => {
      const { programs, destination } = strings.settings.tabs
      for (const message of [
        strings.editor.playlists.unconfirmed,
        strings.editor.cues.traktor.noCollection,
        strings.editor.cues.traktor.otherCollection,
        strings.sources.notFound.engine,
      ]) {
        expect(message, message).toContain(`→ ${programs}`)
        expect(message, message).not.toContain(`→ ${destination}`)
      }
    })
  }
})
