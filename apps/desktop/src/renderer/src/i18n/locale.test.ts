import { describe, expect, it } from 'vitest'
import { baseLocale, nextLocale, resolveLocale } from './locale'

// Any tag the OS or i18next can report (es-ES, pt-PT, de-AT…) must land on one of the
// shipped locales, with English as the catch-all — otherwise a regional variant would
// boot an untranslated UI.
describe('baseLocale', () => {
  it('collapses regional variants to their shipped locale', () => {
    expect(baseLocale('es-ES')).toBe('es')
    expect(baseLocale('de-AT')).toBe('de')
    expect(baseLocale('fr-CA')).toBe('fr')
    expect(baseLocale('pt-PT')).toBe('pt-BR')
    expect(baseLocale('pt-BR')).toBe('pt-BR')
  })

  it('falls back to English for anything not shipped', () => {
    expect(baseLocale('ja')).toBe('en')
    expect(baseLocale('en-US')).toBe('en')
  })
})

describe('resolveLocale', () => {
  it('pins an explicit preference and lets system follow the OS', () => {
    expect(resolveLocale('de')).toBe('de')
    expect(resolveLocale('pt-BR')).toBe('pt-BR')
    expect(resolveLocale('system')).toBe(baseLocale(navigator.language))
  })
})

// The ⌘⇧L toggle cycles through the shipped locales in a fixed order, collapsing any
// regional variant (es-ES, en-US) down to its base language first.
describe('nextLocale', () => {
  it('cycles through every shipped locale and wraps around', () => {
    expect(nextLocale('en')).toBe('es')
    expect(nextLocale('es')).toBe('de')
    expect(nextLocale('de')).toBe('fr')
    expect(nextLocale('fr')).toBe('pt-BR')
    expect(nextLocale('pt-BR')).toBe('en')
  })

  it('collapses a regional variant before stepping', () => {
    expect(nextLocale('es-ES')).toBe('de')
    expect(nextLocale('en-US')).toBe('es')
    expect(nextLocale('ja')).toBe('es')
  })
})
