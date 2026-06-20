import { describe, expect, it } from 'vitest'
import { cleanMatchTitle } from './searchClean'

describe('cleanMatchTitle', () => {
  // "(Original Mix)" is the file's name for the default version; catalogs (Discogs) often
  // list it bare ("Timewarp"). Dropping the suffix lets the real track clear the suggestion
  // bar instead of being penalised for words the catalog never carried.
  it('drops a trailing "(Original Mix)" / "(Original)" version marker', () => {
    expect(cleanMatchTitle('Timewarp (Original Mix)')).toBe('Timewarp')
    expect(cleanMatchTitle('Real Love (Original)')).toBe('Real Love')
    expect(cleanMatchTitle('Strobe (Original Version)')).toBe('Strobe')
  })

  // Meaningful mixes must survive — they distinguish the version the file actually is, so a
  // release that keeps the right mix can still out-score the bare cut.
  it('keeps a meaningful mix name that disambiguates the version', () => {
    expect(cleanMatchTitle('Acid (Extended Mix)')).toBe('Acid (Extended Mix)')
    expect(cleanMatchTitle('Acid (Dub)')).toBe('Acid (Dub)')
    expect(cleanMatchTitle('Acid (Klubb Mix)')).toBe('Acid (Klubb Mix)')
  })

  it('leaves a clean title unchanged', () => {
    expect(cleanMatchTitle('Timewarp')).toBe('Timewarp')
  })
})
