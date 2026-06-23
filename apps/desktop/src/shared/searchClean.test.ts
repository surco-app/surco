import { describe, expect, it } from 'vitest'
import { cleanMatchTitle, dropLeadingCatalog } from './searchClean'

describe('dropLeadingCatalog', () => {
  // A label/catalog code prefixed to a DJ-rip file name ("BL2-045 Artist - Title") survives
  // into the free-text query and breaks search: the specific candidates return nothing and
  // the bare code matches dozens of unrelated catalogs. It must be dropped from the lead.
  it('drops a leading label/catalog code so the artist leads the query', () => {
    expect(dropLeadingCatalog('BL2-045 Tito Dj & Solá Brothers Love Again')).toBe(
      'Tito Dj & Solá Brothers Love Again',
    )
    expect(dropLeadingCatalog('SRC001 Rank 1 Airwave')).toBe('Rank 1 Airwave')
    expect(dropLeadingCatalog('CAT-12345 Artist Title')).toBe('Artist Title')
  })

  // The shape is tight on purpose: it must never eat a numeric act name. One-letter+digit
  // names, digit-led names and long-prefixed names all fall outside it.
  it('leaves a numeric artist name untouched', () => {
    expect(dropLeadingCatalog('U2 One')).toBe('U2 One')
    expect(dropLeadingCatalog('M83 Midnight City')).toBe('M83 Midnight City')
    expect(dropLeadingCatalog('808 State Pacific')).toBe('808 State Pacific')
    expect(dropLeadingCatalog('Blink-182 All The Small Things')).toBe(
      'Blink-182 All The Small Things',
    )
    expect(dropLeadingCatalog('Apollo 440 Stop The Rock')).toBe('Apollo 440 Stop The Rock')
    expect(dropLeadingCatalog('Sum 41 Fat Lip')).toBe('Sum 41 Fat Lip')
  })

  // A query that is *only* the code (the standalone catalog candidate) keeps it: there is no
  // trailing artist to lead with, so stripping would blank the search.
  it('leaves a bare code unchanged', () => {
    expect(dropLeadingCatalog('BL2-045')).toBe('BL2-045')
  })
})

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
