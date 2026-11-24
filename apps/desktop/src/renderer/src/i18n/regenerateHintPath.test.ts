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
