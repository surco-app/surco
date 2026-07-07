import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { sanitizeMeta } from './hygiene'

function meta(patch: Partial<TrackMetadata>): TrackMetadata {
  return {
    title: '',
    artist: '',
    album: '',
    albumArtist: '',
    year: '',
    genre: '',
    grouping: '',
    comment: '',
    trackNumber: '',
    discNumber: '',
    bpm: '',
    key: '',
    publisher: '',
    catalogNumber: '',
    remixArtist: '',
    ...patch,
  }
}

describe('sanitizeMeta', () => {
  it('trims and collapses whitespace so stray spaces never reach the tags', () => {
    const r = sanitizeMeta(meta({ title: '  Open   Your Eyes  ', artist: ' Chumi Dj ' }), {
      trim: true,
      zeroPad: false,
    })
    expect(r.title).toBe('Open Your Eyes')
    expect(r.artist).toBe('Chumi Dj')
  })

  it('zero-pads the track number so it sorts and shows as 03, not 3', () => {
    expect(
      sanitizeMeta(meta({ trackNumber: '3' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('03')
    expect(
      sanitizeMeta(meta({ trackNumber: '12' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('12')
  })

  it('leaves an empty track number alone instead of padding it to 00', () => {
    expect(
      sanitizeMeta(meta({ trackNumber: '' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('')
  })

  it('leaves a vinyl position untouched when zero-padding, keeping the side letter', () => {
    // "A1" from a Discogs vinyl release is the whole value; stripping to digits and
    // padding ("01") destroys exactly what collectors tag for.
    expect(
      sanitizeMeta(meta({ trackNumber: 'A1' }), { trim: false, zeroPad: true }).trackNumber,
    ).toBe('A1')
  })

  it('applies nothing when both options are off', () => {
    const input = meta({ title: '  x  ', trackNumber: '3' })
    const r = sanitizeMeta(input, { trim: false, zeroPad: false })
    expect(r.title).toBe('  x  ')
    expect(r.trackNumber).toBe('3')
  })
})
