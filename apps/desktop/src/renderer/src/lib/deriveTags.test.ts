import { describe, expect, it } from 'vitest'
import { deriveTags, smartDeriveTags } from './deriveTags'

describe('deriveTags', () => {
  it('pulls artist and title out of a "{artist} - {title}" name', () => {
    expect(deriveTags('kumara - snap ya fingaz.flac', '{artist} - {title}')).toEqual({
      artist: 'kumara',
      title: 'snap ya fingaz',
    })
  })

  it('reads a leading track number with the release tokens', () => {
    expect(deriveTags('104. kumara - snap.flac', '{trackNumber}. {artist} - {title}')).toEqual({
      trackNumber: '104',
      artist: 'kumara',
      title: 'snap',
    })
  })

  it('lets the last token keep separators that also appear inside it', () => {
    // The artist group is lazy and stops at the first " - "; the title keeps the rest, so a
    // remix tagged "Artist - Title - Extended" does not lose its suffix.
    expect(deriveTags('a - b - c.flac', '{artist} - {title}')).toEqual({
      artist: 'a',
      title: 'b - c',
    })
  })

  it('returns nothing when the name does not fit the pattern, so tags are not blanked', () => {
    expect(deriveTags('noseparatorhere.flac', '{artist} - {title}')).toEqual({})
  })

  it('omits a field the name leaves empty rather than writing a blank', () => {
    expect(deriveTags(' - snap.flac', '{artist} - {title}')).toEqual({ title: 'snap' })
  })

  it('ignores a token that is not a real metadata field', () => {
    expect(deriveTags('x - y.flac', '{bogus} - {title}')).toEqual({ title: 'y' })
  })

  it('strips the extension before matching so it never leaks into a field', () => {
    expect(deriveTags('only a title.mp3', '{title}')).toEqual({ title: 'only a title' })
  })

  it('captures a track number as digits only, so a non-numbered name does not match it', () => {
    expect(deriveTags('kumara. snap.flac', '{trackNumber}. {title}')).toEqual({})
  })
})

describe('smartDeriveTags', () => {
  it('reads a leading track number when present', () => {
    expect(smartDeriveTags('104. kumara - snap.flac')).toEqual({
      trackNumber: '104',
      artist: 'kumara',
      title: 'snap',
    })
  })

  it('handles a space-separated track number too', () => {
    expect(smartDeriveTags('104 kumara - snap.flac')).toEqual({
      trackNumber: '104',
      artist: 'kumara',
      title: 'snap',
    })
  })

  it('falls back to plain Artist - Title and never mistakes the artist for a number', () => {
    // The digit-only track number is what stops "A - B - C" reading "A" as a track number.
    expect(smartDeriveTags('A - B - C.flac')).toEqual({ artist: 'A', title: 'B - C' })
  })

  it('returns nothing when no common naming fits', () => {
    expect(smartDeriveTags('noseparator.flac')).toEqual({})
  })
})
