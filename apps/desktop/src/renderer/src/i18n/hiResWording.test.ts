import { describe, expect, it } from 'vitest'
import ca from './locales/ca.json'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import it_ from './locales/it.json'
import ja from './locales/ja.json'
import ptBR from './locales/pt-BR.json'

const locales = { ca, de, en, es, fr, it: it_, ja, 'pt-BR': ptBR }

const verdictAdjectives =
  /auth?[eéèê]ntic|authentique|\bvraie?s?\b|genuin|genu[ií]no|\becht\w*|verdader|verdadeiro|本物|真の|real hi-res/i

describe('editor.qualityHiRes', () => {
  for (const [code, locale] of Object.entries(locales)) {
    const text = locale.editor.qualityHiRes

    it(`${code} claims only what the detector measures, never that the file is authentic`, () => {
      expect(text).not.toMatch(verdictAdjectives)
    })

    it(`${code} keeps the sample rate and the 22 kHz threshold`, () => {
      expect(text).toContain('{{rate}}')
      expect(text).toContain('22 kHz')
    })

    it(`${code} states it in plain sentences, without a dash or an explanatory colon`, () => {
      expect(text).not.toMatch(/[—:：]/)
    })
  }

  it('es and en give the exact agreed wording', () => {
    expect(es.editor.qualityHiRes).toBe(
      'Hay contenido real por encima de 22 kHz. Este archivo a {{rate}} no viene de calidad CD (44,1 kHz).',
    )
    expect(en.editor.qualityHiRes).toBe(
      'There is real content above 22 kHz. This {{rate}} file does not come from CD quality (44.1 kHz).',
    )
  })
})

describe('sidebar.filter.upsampled', () => {
  const bareWord = {
    ca: 'Reescalat',
    de: 'Hochgerechnet',
    en: 'Upsampled',
    es: 'Reescalado',
    fr: 'Suréchantillonné',
    it: 'Ricampionato',
    ja: 'アップサンプリング',
    'pt-BR': 'Reamostrado',
  }

  for (const [code, locale] of Object.entries(locales)) {
    it(`${code} names the filter as a possibility, because the list cannot claim more than the editor measures`, () => {
      expect(locale.sidebar.filter.upsampled).not.toBe(bareWord[code as keyof typeof bareWord])
    })
  }

  for (const [code, locale] of Object.entries(locales)) {
    it(`${code} keeps the filter label within its 163 px column so the count stays aligned`, () => {
      expect([...locale.sidebar.filter.upsampled].length).toBeLessThanOrEqual(27)
    })
  }

  it('ja keeps the filter label within 14 characters because wide glyphs are cut off before the count', () => {
    expect([...ja.sidebar.filter.upsampled].length).toBeLessThanOrEqual(14)
  })

  it('es and en name it as the editor badge names possible reprocessing', () => {
    expect(es.sidebar.filter.upsampled).toBe('Posible reescalado')
    expect(en.sidebar.filter.upsampled).toBe('Possibly upsampled')
  })
})
