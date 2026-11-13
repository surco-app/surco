import { describe, expect, it } from 'vitest'
import { sessionDateLabel, uniqueName } from '../shared/sessionName'
import { validCrateName } from './seratoCrateFile'

describe('session names against the Serato crate rules', () => {
  const day = new Date(2026, 10, 9)

  it('refuses the slash a local date would bring, which is why the label has none', () => {
    expect(validCrateName('Sesión del 9/11')).toBe(false)
  })

  it('accepts the dated name in every locale the app ships', () => {
    for (const locale of ['es', 'en', 'de', 'fr', 'ja', 'pt-BR', 'ca']) {
      expect(validCrateName(`Sesión del ${sessionDateLabel(day, locale)}`)).toBe(true)
    }
  })

  it('accepts the numbered name a second session on the same day gets', () => {
    const taken = new Set([`Sesión del ${sessionDateLabel(day, 'es')}`])
    expect(validCrateName(uniqueName(`Sesión del ${sessionDateLabel(day, 'es')}`, taken))).toBe(
      true,
    )
  })
})
