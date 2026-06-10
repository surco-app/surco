import { describe, expect, it } from 'vitest'
import { nextLocale } from './locale'

// The ⌘⇧L toggle only ever flips between the two shipped locales, so picking the "other"
// one has to collapse any regional variant (es-ES, en-US) down to its base language first.
describe('nextLocale', () => {
  it('flips Spanish to English and English to Spanish', () => {
    expect(nextLocale('es')).toBe('en')
    expect(nextLocale('en')).toBe('es')
  })

  it('treats any Spanish variant as Spanish and everything else as English', () => {
    expect(nextLocale('es-ES')).toBe('en')
    expect(nextLocale('en-US')).toBe('es')
    expect(nextLocale('fr')).toBe('es')
  })
})
