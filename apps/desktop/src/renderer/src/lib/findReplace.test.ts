import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../../../shared/types'
import { findReplaceTrack, isValidRegex, replaceInValue } from './findReplace'

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

describe('replaceInValue', () => {
  it('replaces every plain-text occurrence', () => {
    expect(replaceInValue('a-a-a', 'a', 'b')).toBe('b-b-b')
  })

  it('is case-insensitive by default but exact when asked', () => {
    expect(replaceInValue('FOO foo', 'foo', 'x')).toBe('x x')
    expect(replaceInValue('FOO foo', 'foo', 'x', { caseSensitive: true })).toBe('FOO x')
  })

  it('treats the replacement literally in plain mode, so "$1" stays "$1"', () => {
    // Without literal handling, "$1" would be read as a capture reference and vanish.
    expect(replaceInValue('a x', 'x', '$1')).toBe('a $1')
  })

  it('treats find as a pattern in regex mode', () => {
    expect(replaceInValue('Track 01', '\\d+', '#', { regex: true })).toBe('Track #')
  })

  it('supports $1 capture groups in regex mode', () => {
    expect(replaceInValue('Artist - Title', '(.+) - (.+)', '$2 by $1', { regex: true })).toBe(
      'Title by Artist',
    )
  })

  it('leaves the value untouched when the regex is invalid or the find is empty', () => {
    expect(replaceInValue('keep me', '(', 'x', { regex: true })).toBe('keep me')
    expect(replaceInValue('keep me', '', 'x')).toBe('keep me')
  })
})

describe('isValidRegex', () => {
  it('flags a malformed pattern so the panel can warn instead of throwing', () => {
    expect(isValidRegex('(.+)')).toBe(true)
    expect(isValidRegex('(')).toBe(false)
  })
})

describe('findReplaceTrack', () => {
  it('returns only the text fields that changed, leaving the rest out', () => {
    const m = meta({ title: 'Snap (Original Mix)', artist: 'Kumara', year: '2000' })
    expect(findReplaceTrack(m, 'Original Mix', 'Radio Edit')).toEqual({
      title: 'Snap (Radio Edit)',
    })
  })

  it('never touches numeric fields, so a digit search cannot mangle the year or track no.', () => {
    const m = meta({ title: '2000 mix', year: '2000', trackNumber: '2' })
    const out = findReplaceTrack(m, '2000', 'two thousand')
    expect(out.title).toBe('two thousand mix')
    expect('year' in out).toBe(false)
    expect('trackNumber' in out).toBe(false)
  })
})
