import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// English is the fallback and must be ready synchronously at import time — every
// other locale is ~50 KB of JSON that only one active language ever needs, so it
// must not sit in the initial bundle.
describe('i18n lazy locale loading', () => {
  beforeEach(() => {
    // Each test re-imports the module fresh so init-time resource registration is
    // observed exactly once per test, not polluted by a previous test's import.
    return import('./index').then(() => undefined)
  })

  it('has the English fallback bundle available at startup', async () => {
    const i18n = (await import('./index')).default
    expect(i18n.hasResourceBundle('en', 'translation')).toBe(true)
    // Spot-check an actual key resolves, not just that the namespace exists.
    expect(i18n.getResourceBundle('en', 'translation').common).toBeDefined()
  })

  it('does not register a non-active locale bundle at startup', async () => {
    const i18n = (await import('./index')).default
    // The test environment's navigator.language is en-US, so the module boots on
    // English; the other four locales must stay unregistered until requested.
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(false)
    expect(i18n.hasResourceBundle('de', 'translation')).toBe(false)
    expect(i18n.hasResourceBundle('fr', 'translation')).toBe(false)
    expect(i18n.hasResourceBundle('pt-BR', 'translation')).toBe(false)
  })

  it('loads and registers a locale bundle before changeLanguage resolves', async () => {
    const i18n = (await import('./index')).default
    await i18n.changeLanguage('es')
    expect(i18n.hasResourceBundle('es', 'translation')).toBe(true)
    expect(i18n.language).toBe('es')
    // The real Spanish string, not an English fallback and not a raw key.
    expect(i18n.t('common.cancel')).not.toBe('common.cancel')
    expect(i18n.t('common.cancel')).not.toBe(i18n.getFixedT('en')('common.cancel'))
  })

  it('never renders a raw key while a locale bundle is still loading', async () => {
    const i18n = (await import('./index')).default
    const pending = i18n.changeLanguage('de')
    // Before the dynamic import settles, t() must still resolve through the
    // English fallback rather than emit the bare key.
    expect(i18n.t('common.cancel')).not.toBe('common.cancel')
    await pending
  })
})

// Cold start can race two switches at once: the module's own OS-locale apply and
// useSettings' saved-preference effect on mount. Whichever bundle happens to finish
// loading last must not silently win over a request made more recently — the two
// import() calls below are held open with deferred promises so the test controls
// which one "arrives" first, independent of real fetch timing.
describe('i18n lazy locale loading - concurrent switches', () => {
  afterEach(() => {
    vi.doUnmock('./locales/es.json')
    vi.doUnmock('./locales/de.json')
    vi.resetModules()
  })

  it('a slower-loading earlier switch does not override a newer one', async () => {
    let resolveEs: (mod: { default: unknown }) => void = () => {}
    let resolveDe: (mod: { default: unknown }) => void = () => {}
    const esImport = new Promise<{ default: unknown }>((resolve) => {
      resolveEs = resolve
    })
    const deImport = new Promise<{ default: unknown }>((resolve) => {
      resolveDe = resolve
    })
    vi.doMock('./locales/es.json', () => esImport)
    vi.doMock('./locales/de.json', () => deImport)

    const i18n = (await import('./index')).default
    const first = i18n.changeLanguage('es')
    const second = i18n.changeLanguage('de')

    // The earlier request's bundle resolves after the later one's — a real-world
    // ordering that a plain "last one to register wins" implementation would get
    // backwards.
    resolveDe({ default: { common: { cancel: 'Abbrechen' } } })
    await second
    resolveEs({ default: { common: { cancel: 'Cancelar' } } })
    await first

    expect(i18n.language).toBe('de')
  })

  it('a failed bundle load leaves the language unchanged and does not reject', async () => {
    vi.doMock('./locales/es.json', () => Promise.reject(new Error('chunk load failed')))

    const i18n = (await import('./index')).default
    const before = i18n.language
    await expect(i18n.changeLanguage('es')).resolves.toBeDefined()
    expect(i18n.language).toBe(before)
  })
})
