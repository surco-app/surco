import { describe, expect, it } from 'vitest'
import { splitPosition } from './position'

describe('splitPosition', () => {
  it('splits a multi-disc position so disc and track are tagged separately', () => {
    // Discogs writes CD positions as "disc-track"; folding both into the track
    // number (the old behaviour) turned "2-3" into "23"
    expect(splitPosition('2-3')).toEqual({ disc: '2', track: '3' })
    expect(splitPosition('1-12')).toEqual({ disc: '1', track: '12' })
  })

  it('keeps a vinyl side position as a plain track number with no disc', () => {
    // "A1"/"B2" are sides, not discs, so disc stays empty
    expect(splitPosition('A1')).toEqual({ disc: '', track: '1' })
    expect(splitPosition('B2')).toEqual({ disc: '', track: '2' })
  })

  it('handles a bare track number', () => {
    expect(splitPosition('5')).toEqual({ disc: '', track: '5' })
  })

  it('returns empty parts when the position carries no digits', () => {
    expect(splitPosition('A')).toEqual({ disc: '', track: '' })
  })
})
