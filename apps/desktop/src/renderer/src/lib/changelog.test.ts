import { describe, expect, it } from 'vitest'
import changelogEn from '../../../../../web/src/i18n/changelog/en.json'
import changelogEs from '../../../../../web/src/i18n/changelog/es.json'
import { changelogReleases } from './changelog'

describe('desktop changelog locale fallback', () => {
  it('uses Spanish only for Spanish and English for every other UI locale', () => {
    expect(changelogReleases('es')).toBe(changelogEs)

    for (const locale of ['en', 'de', 'fr', 'pt-BR', 'ja']) {
      expect(changelogReleases(locale)).toBe(changelogEn)
    }
  })
})
