import { describe, expect, it } from 'vitest'
import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import changelogJa from '../../../../../web/src/i18n/changelog/ja.json'
import { changelogReleases } from './changelog'

describe('desktop changelog locale fallback', () => {
  it('uses the curated history of Spanish and Japanese, and English for every other UI locale', () => {
    expect(changelogReleases('es')).toBe(changelogEs)
    expect(changelogReleases('ja')).toBe(changelogJa)

    for (const locale of ['en', 'de', 'fr', 'pt-BR']) {
      expect(changelogReleases(locale)).toBe(changelogEn)
    }
  })
})
