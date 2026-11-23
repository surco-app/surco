import { describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { missingSummary } from './missingSummary'

const tr = i18n.getFixedT('en')

describe('missingSummary', () => {
  // The line sits above the main button in one row. Naming every empty field ran to "Title,
  // Artist, Year, Genre, Grouping, Album" and kept growing with the user's required set, so
  // past two names it counts instead: the form already marks each empty field with its dot.
  it('names one or two missing fields and counts from three on', () => {
    expect(missingSummary(['Grouping'], tr)).toBe('Missing Grouping')
    expect(missingSummary(['Grouping', 'Album'], tr)).toBe('Missing Grouping and Album')
    expect(missingSummary(['Title', 'Artist', 'Year', 'Genre', 'Grouping', 'Album'], tr)).toBe(
      '6 required fields missing',
    )
  })

  // Over several tracks that lack different fields, «Missing Title and Artist» told the user
  // every track lacked both. The two names then read as alternatives, with one field's verb.
  it.each([
    ['es', 'Falta Título o Artista'],
    ['en', 'Missing Title or Artist'],
  ])(
    'names two fields as alternatives in %s when the tracks lack different ones',
    async (language, said) => {
      await i18n.changeLanguage(language)
      try {
        const t = i18n.getFixedT(language)
        expect(missingSummary([t('fields.title'), t('fields.artist')], t, true)).toBe(said)
      } finally {
        await i18n.changeLanguage('en')
      }
    },
  )
})
