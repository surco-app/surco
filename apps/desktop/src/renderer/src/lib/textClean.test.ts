import { describe, expect, it } from 'vitest'
import { stripParentheticals } from './textClean'

describe('stripParentheticals', () => {
  // The whole point: a track title carries its mix as a parenthetical, and the
  // album rarely does — so dropping "(Original mix)" turns a title into the album.
  it('drops a trailing mix parenthetical', () => {
    expect(stripParentheticals('Nordic Dome (Original mix)')).toBe('Nordic Dome')
  })

  // Rips also tack on bracketed label/catalog provenance, which is no part of the
  // release name either.
  it('drops bracketed label provenance too', () => {
    expect(stripParentheticals('My Weapon [Label 001] (Extended Mix)')).toBe('My Weapon')
  })

  // A value with nothing to strip must come back identical — the caller uses that
  // equality to decide there is no clean-up to offer.
  it('leaves a clean value untouched', () => {
    expect(stripParentheticals('Nordic Dome')).toBe('Nordic Dome')
  })

  // An all-parenthetical value strips to nothing; the caller drops the empty result.
  it('returns empty when the whole value was parenthetical', () => {
    expect(stripParentheticals('(Intro)')).toBe('')
  })
})
