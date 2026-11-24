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

// The right-click item throws away the track's edits and match and re-reads the file.
// «Start over» read as restarting the app or the list; it carries the same name as the
// cue editor's own discard, so a DJ recognises the one action that drops their edits.
describe('the context menu names start over as discarding the changes', () => {
  for (const [lang, strings] of Object.entries(LOCALES)) {
    it(`uses the cue editor's discard wording in ${lang}`, () => {
      expect(strings.trackList.context.startOver).toBe(strings.editor.cues.discard)
    })
  }
})
