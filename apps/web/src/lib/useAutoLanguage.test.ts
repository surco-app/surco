import { describe, expect, it } from 'vitest'
import { suggestsEnglish } from './useAutoLanguage'

// Googlebot renders with an English browser and no saved choice. When that visit was
// redirected to /en, the Spanish pages read as redirects and fell out of the index, so
// the English offer is now a suggestion the visitor accepts, never a navigation.
describe('suggestsEnglish', () => {
  it('offers English to an English browser on a Spanish page', () => {
    expect(suggestsEnglish(null, '/funciones', 'en-US')).toBe(true)
  })

  it('stays quiet for a Spanish browser', () => {
    expect(suggestsEnglish(null, '/', 'es-ES')).toBe(false)
  })

  it('stays quiet on the English pages, where the visitor already is', () => {
    expect(suggestsEnglish(null, '/en/guide', 'en-US')).toBe(false)
  })

  it('never overrides a language the visitor picked or dismissed', () => {
    expect(suggestsEnglish('es', '/', 'en-US')).toBe(false)
  })
})
