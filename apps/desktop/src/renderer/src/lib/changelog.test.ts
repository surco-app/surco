import { describe, expect, it, vi } from 'vitest'
import changelogCa from '../../../../../web/src/i18n/changelog/ca.json'
import changelogDe from '../../../../../web/src/i18n/changelog/de.json'
import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import changelogFr from '../../../../../web/src/i18n/changelog/fr.json'
import changelogIt from '../../../../../web/src/i18n/changelog/it.json'
import changelogJa from '../../../../../web/src/i18n/changelog/ja.json'
import changelogPtBR from '../../../../../web/src/i18n/changelog/pt-BR.json'

describe('desktop changelog locale', () => {
  it('shows every UI language its own release history', async () => {
    const { changelogReleases } = await import('./changelog')
    expect(await changelogReleases('en')).toBe(changelogEn)
    expect(await changelogReleases('es')).toBe(changelogEs)
    expect(await changelogReleases('de')).toBe(changelogDe)
    expect(await changelogReleases('fr')).toBe(changelogFr)
    expect(await changelogReleases('pt-BR')).toBe(changelogPtBR)
    expect(await changelogReleases('ja')).toBe(changelogJa)
    expect(await changelogReleases('ca')).toBe(changelogCa)
    expect(await changelogReleases('it')).toBe(changelogIt)
  })

  it('falls back to the English history for a language without a changelog', async () => {
    const { changelogReleases } = await import('./changelog')
    expect(await changelogReleases('xx')).toBe(changelogEn)
  })

  // Six full release histories weighed 1.6 MB of the startup chunk, parsed on every
  // launch although a launch shows at most one of them and most show none. Only the
  // language asked for may be loaded, and only when it is asked for.
  it('loads no history until one is asked for, and then only that language', async () => {
    vi.resetModules()
    const loaded: string[] = []
    const track = (locale: string) => () => {
      loaded.push(locale)
      return { default: [] }
    }
    vi.doMock('../../../../../web/src/i18n/changelog/en.json', track('en'))
    vi.doMock('../../../../../web/src/i18n/changelog/es.json', track('es'))
    vi.doMock('../../../../../web/src/i18n/changelog/de.json', track('de'))
    vi.doMock('../../../../../web/src/i18n/changelog/fr.json', track('fr'))
    vi.doMock('../../../../../web/src/i18n/changelog/pt-BR.json', track('pt-BR'))
    vi.doMock('../../../../../web/src/i18n/changelog/ja.json', track('ja'))
    vi.doMock('../../../../../web/src/i18n/changelog/ca.json', track('ca'))
    vi.doMock('../../../../../web/src/i18n/changelog/it.json', track('it'))

    const { changelogReleases } = await import('./changelog')
    expect(loaded).toEqual([])

    await changelogReleases('es')
    expect(loaded).toEqual(['es'])

    vi.doUnmock('../../../../../web/src/i18n/changelog/en.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/es.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/de.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/fr.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/pt-BR.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/ja.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/ca.json')
    vi.doUnmock('../../../../../web/src/i18n/changelog/it.json')
    vi.resetModules()
  })
})
