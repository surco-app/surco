import { describe, expect, it } from 'vitest'
import { splitPosition } from './position'

describe('splitPosition', () => {
  it('splits a multi-disc position so disc and track are tagged separately', () => {
    // Discogs writes CD positions as "disc-track"; folding both into the track
    // number (the old behaviour) turned "2-3" into "23"
    expect(splitPosition('2-3')).toEqual({ disc: '2', track: '3' })
    expect(splitPosition('1-12')).toEqual({ disc: '1', track: '12' })
  })

  it('keeps a vinyl side position verbatim — for collectors A1 IS the track number', () => {
    // Discogs-style taggers write the side position straight into the track field;
    // reducing "A2" to "2" is what users reported as data loss. No disc either way.
    expect(splitPosition('A1')).toEqual({ disc: '', track: 'A1' })
    expect(splitPosition('B2')).toEqual({ disc: '', track: 'B2' })
    // 7" singles list a bare side letter
    expect(splitPosition('A')).toEqual({ disc: '', track: 'A' })
    // Double-A-side singles repeat the letter ("AA", or "AA1" when numbered)
    expect(splitPosition('AA')).toEqual({ disc: '', track: 'AA' })
    expect(splitPosition('AA1')).toEqual({ disc: '', track: 'AA1' })
  })

  it('handles a bare track number', () => {
    expect(splitPosition('5')).toEqual({ disc: '', track: '5' })
  })

  it('keeps the digits-only fallback for positions that are not vinyl sides', () => {
    // Two-letter prefixes ("CD1") are media labels, not sides — the old digits
    // behaviour still applies to them.
    expect(splitPosition('CD1')).toEqual({ disc: '', track: '1' })
  })
})
