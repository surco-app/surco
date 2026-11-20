import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import fr from './locales/fr.json'
import itIT from './locales/it.json'

async function fixedT(lng: 'fr' | 'it') {
  const instance = i18next.createInstance()
  await instance.init({
    lng,
    resources: { fr: { translation: fr }, it: { translation: itIT } },
    interpolation: { escapeValue: false },
  })
  return instance.t
}

describe('trash.restoreFailedMany', () => {
  it('reads as one other file in French when a single one more failed, never «1 autres»', async () => {
    const t = await fixedT('fr')
    expect(t('trash.restoreFailedMany', { name: 'a.wav', count: 1, reason: 'x' })).toBe(
      'Impossible de restaurer « a.wav » et 1 autre : x',
    )
    expect(t('trash.restoreFailedMany', { name: 'a.wav', count: 3, reason: 'x' })).toBe(
      'Impossible de restaurer « a.wav » et 3 autres : x',
    )
  })

  it('reads as one other file in Italian when a single one more failed, never «altri 1»', async () => {
    const t = await fixedT('it')
    expect(t('trash.restoreFailedMany', { name: 'a.wav', count: 1, reason: 'x' })).toBe(
      'Non è stato possibile ripristinare «a.wav» e un altro. x',
    )
    expect(t('trash.restoreFailedMany', { name: 'a.wav', count: 3, reason: 'x' })).toBe(
      'Non è stato possibile ripristinare «a.wav» e altri 3. x',
    )
  })
})
