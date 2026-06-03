import { describe, expect, it } from 'vitest'
import { createMenuT, pickMenuLang } from './i18n'

describe('pickMenuLang', () => {
  // The native menu lives in the main process, which has no access to the
  // renderer's navigator.language. It must reach the same es/en decision from
  // the OS locale so the menu bar matches the rest of the UI instead of always
  // showing the hardcoded Spanish it used to.
  it('chooses Spanish for any es-* locale', () => {
    expect(pickMenuLang('es-ES')).toBe('es')
    expect(pickMenuLang('es')).toBe('es')
  })

  it('falls back to English for anything else', () => {
    expect(pickMenuLang('en-US')).toBe('en')
    expect(pickMenuLang('fr-FR')).toBe('en')
    expect(pickMenuLang('')).toBe('en')
  })
})

describe('createMenuT', () => {
  it('translates a key for the resolved locale', () => {
    expect(createMenuT('es-ES')('settings')).toBe('Ajustes…')
    expect(createMenuT('en-US')('settings')).toBe('Settings…')
  })

  it('uses English when the locale is unsupported', () => {
    expect(createMenuT('de-DE')('feedback')).toBe('Send feedback…')
  })

  it('covers the menus added beyond the original two items', () => {
    expect(createMenuT('es')('checkUpdates')).toBe('Buscar actualizaciones…')
    expect(createMenuT('en')('checkUpdates')).toBe('Check for Updates…')
    expect(createMenuT('es')('file')).toBe('Archivo')
    expect(createMenuT('en')('help')).toBe('Help')
    expect(createMenuT('es')('faq')).toBe('Preguntas frecuentes')
    expect(createMenuT('en')('faq')).toBe('Frequently Asked Questions')
  })
})
