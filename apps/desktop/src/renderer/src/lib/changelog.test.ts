import { describe, expect, it } from 'vitest'
import changelogDe from '../../../../../web/src/i18n/changelog/de.json'
import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import changelogFr from '../../../../../web/src/i18n/changelog/fr.json'
import changelogJa from '../../../../../web/src/i18n/changelog/ja.json'
import changelogPtBR from '../../../../../web/src/i18n/changelog/pt-BR.json'
import { changelogReleases } from './changelog'

describe('desktop changelog locale', () => {
  it('shows every UI language its own release history', () => {
    expect(changelogReleases('en')).toBe(changelogEn)
    expect(changelogReleases('es')).toBe(changelogEs)
    expect(changelogReleases('de')).toBe(changelogDe)
    expect(changelogReleases('fr')).toBe(changelogFr)
    expect(changelogReleases('pt-BR')).toBe(changelogPtBR)
    expect(changelogReleases('ja')).toBe(changelogJa)
  })
})
