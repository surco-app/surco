import { describe, expect, it } from 'vitest'
import { titleCase } from './textCase'

describe('titleCase', () => {
  it('rescues a caps-lock field by capitalizing every word, the DJ-store convention (Beatport/Discogs) rather than editorial small-word lowering', () => {
    expect(titleCase('STERDAM DANCE CAPITAL')).toBe('Sterdam Dance Capital')
    expect(titleCase('mango logo anthem')).toBe('Mango Logo Anthem')
  })

  it('keeps DJ-culture acronyms whole — an all-caps source gives no other clue that DJ or EP are not plain words', () => {
    expect(titleCase('dj freekfunk & bo bensdorp')).toBe('DJ Freekfunk & Bo Bensdorp')
    expect(titleCase('SUNDAY VIBES EP')).toBe('Sunday Vibes EP')
  })

  it('preserves internal capitals in words that are already mixed case, so re-running it never mangles McCoy or AceMo', () => {
    expect(titleCase('paul McCartney')).toBe('Paul McCartney')
    expect(titleCase('Tony Humphries Meets AceMo')).toBe('Tony Humphries Meets AceMo')
  })

  it('treats apostrophes as part of the word so contractions come out as one capital', () => {
    expect(titleCase("DON'T STOP")).toBe("Don't Stop")
  })

  it('capitalizes inside parentheses and brackets, where mix names live', () => {
    expect(titleCase('clear blue water (original mix) [adc042]')).toBe(
      'Clear Blue Water (Original Mix) [Adc042]',
    )
  })

  it('handles accented and non-ASCII letters', () => {
    expect(titleCase('LA NOCHE MÁGICA')).toBe('La Noche Mágica')
  })
})
