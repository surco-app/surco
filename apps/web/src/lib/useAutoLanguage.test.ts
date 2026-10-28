import { describe, expect, it } from 'vitest'
import { suggestedLanguage } from './useAutoLanguage'

// Googlebot renders with an English browser and no saved choice. When that visit was
// redirected to /en, the Spanish pages read as redirects and fell out of the index, so
// the offer is now a suggestion the visitor accepts, never a navigation. Search lands
// visitors on the Spanish pages; the offer is how they learn their language exists.
describe('suggestedLanguage', () => {
  it('offers English to an English browser on a Spanish page', () => {
    expect(suggestedLanguage(null, '/funciones', 'en-US')).toBe('en')
  })

  it('stays quiet for a Spanish browser', () => {
    expect(suggestedLanguage(null, '/', 'es-ES')).toBeNull()
  })

  it('offers Japanese to a Japanese browser on the Spanish page', () => {
    expect(suggestedLanguage(null, '/', 'ja-JP')).toBe('ja')
    expect(suggestedLanguage(null, '/guia', 'ja')).toBe('ja')
  })

  it('offers German, French and Portuguese browsers their own site', () => {
    expect(suggestedLanguage(null, '/', 'de-DE')).toBe('de')
    expect(suggestedLanguage(null, '/guia', 'fr-CA')).toBe('fr')
    expect(suggestedLanguage(null, '/', 'pt-PT')).toBe('pt-BR')
    expect(suggestedLanguage(null, '/', 'pt')).toBe('pt-BR')
  })

  it('offers English to browsers in a language the site does not have', () => {
    expect(suggestedLanguage(null, '/', 'it-IT')).toBe('en')
    expect(suggestedLanguage(null, '/guia', 'nl-NL')).toBe('en')
  })

  it('stays quiet on the English pages, where the visitor already is', () => {
    expect(suggestedLanguage(null, '/en/guide', 'en-US')).toBeNull()
  })

  it('never offers anything on the German, French or Portuguese pages', () => {
    expect(suggestedLanguage(null, '/de', 'en-US')).toBeNull()
    expect(suggestedLanguage(null, '/fr/guide', 'es-ES')).toBeNull()
    expect(suggestedLanguage(null, '/pt/use-cases', 'ja-JP')).toBeNull()
  })

  it('never offers anything on Japanese pages', () => {
    expect(suggestedLanguage(null, '/ja', 'en-US')).toBeNull()
    expect(suggestedLanguage(null, '/ja/guide', 'en-US')).toBeNull()
    expect(suggestedLanguage(null, '/ja/use-cases', 'ja-JP')).toBeNull()
  })

  it('never overrides a language the visitor picked or dismissed', () => {
    expect(suggestedLanguage('es', '/', 'en-US')).toBeNull()
    expect(suggestedLanguage('es', '/', 'ja-JP')).toBeNull()
  })
})
