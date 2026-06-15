import { describe, expect, it } from 'vitest'
import { foldText } from './normalizeText'

describe('foldText', () => {
  it('folds accents so an accented title matches its plain spelling', () => {
    // The whole point: a Spanish/Latin catalogue (canción, niña, Tiësto) must match
    // a Discogs title or a search typed without accents.
    expect(foldText('Canción')).toBe('cancion')
    expect(foldText('La Niña')).toBe('la nina')
    expect(foldText('Tiësto')).toBe('tiesto')
    expect(foldText('Müller')).toBe('muller')
  })

  it('treats "&" as "and" so the two spellings compare equal', () => {
    expect(foldText('Above & Beyond')).toBe(foldText('Above and Beyond'))
  })

  it('lowercases and collapses every other separator to single spaces', () => {
    expect(foldText('  Rank 1  -  Airwave ')).toBe('rank 1 airwave')
  })

  it('returns an empty string when there is nothing alphanumeric left', () => {
    expect(foldText('—')).toBe('')
  })
})
