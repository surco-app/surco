import { describe, expect, it } from 'vitest'
import { proposeAlbumClean, stripParentheticals } from './textClean'

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

describe('proposeAlbumClean', () => {
  // The menu offers "Without version" only when stripping removes something, so a clean
  // album must come back as undefined, not as an identical proposal.
  it('proposes the album without its version', () => {
    expect(
      proposeAlbumClean({ isMulti: false, meta: { album: 'Dome (Remixes)', title: 'T' } }),
    ).toBe('Dome')
  })

  it('falls back to the title while the album is empty', () => {
    expect(
      proposeAlbumClean({
        isMulti: false,
        meta: { album: '  ', title: 'Nordic Dome (Original mix)' },
      }),
    ).toBe('Nordic Dome')
  })

  it('offers nothing when there is no version to drop', () => {
    expect(proposeAlbumClean({ isMulti: false, meta: { album: 'Dome', title: 'T (Mix)' } })).toBe(
      undefined,
    )
    expect(proposeAlbumClean({ isMulti: false, meta: { album: '', title: '' } })).toBe(undefined)
  })

  it('offers nothing for a selection', () => {
    expect(
      proposeAlbumClean({ isMulti: true, meta: { album: 'Dome (Remixes)', title: 'T' } }),
    ).toBe(undefined)
  })
})
