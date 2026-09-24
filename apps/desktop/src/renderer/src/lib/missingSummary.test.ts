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
})
