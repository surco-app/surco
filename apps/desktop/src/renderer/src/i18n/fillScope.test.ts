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

// The palette listed "Fill all tags from file name" over "Fill metadata from file name":
// one runs over the whole list and the other over the selection, but "all tags" read as
// every field. The pair is one action in two scopes, so the names share the action and
// differ only by the scope at the end.
describe('the fill-from-file-name commands', () => {
  it.each(Object.entries(LOCALES))(
    'name the same action and only their scope apart in %s',
    (_, locale) => {
      const { fillAll, deriveTags } = locale.commands
      let shared = 0
      while (shared < fillAll.length && fillAll[shared] === deriveTags[shared]) shared += 1
      const action = fillAll.slice(0, shared)
      expect(action.trim().length).toBeGreaterThan(fillAll.length / 2)
      expect(fillAll.slice(shared)).not.toBe('')
      expect(deriveTags.slice(shared)).not.toBe('')
    },
  )
})
