import { describe, expect, it } from 'vitest'
import { fromReadOnlyProgram, isFrom, type TrackOrigin, withPrograms } from './trackOrigin'

describe('isFrom', () => {
  it('is true only for the programs the track arrived from, so a Serato row blocks and a loose file does not', () => {
    const track: TrackOrigin = { programs: ['serato', 'rekordbox'] }
    expect(isFrom(track, 'serato')).toBe(true)
    expect(isFrom(track, 'rekordbox')).toBe(true)
    expect(isFrom(track, 'traktor')).toBe(false)
    expect(isFrom(track, 'engine')).toBe(false)
  })

  it('is false for a track with no programs at all', () => {
    expect(isFrom({}, 'rekordbox')).toBe(false)
    expect(isFrom({ programs: [] }, 'serato')).toBe(false)
  })
})

describe('fromReadOnlyProgram', () => {
  it('is true when any program the track came from cannot be written, so its file is never rewritten behind that program', () => {
    expect(fromReadOnlyProgram({ programs: ['rekordbox', 'serato'] })).toBe(true)
    expect(fromReadOnlyProgram({ programs: ['rekordbox', 'traktor', 'engine'] })).toBe(false)
    expect(fromReadOnlyProgram({ programs: [] })).toBe(false)
    expect(fromReadOnlyProgram({})).toBe(false)
  })
})

describe('withPrograms', () => {
  it('adds a program once, so opening the same file from a library twice does not repeat it', () => {
    expect(withPrograms({ programs: ['traktor'] }, ['traktor', 'serato', 'serato'])).toEqual([
      'traktor',
      'serato',
    ])
  })

  it('keeps the order the programs arrived in', () => {
    expect(withPrograms({ programs: ['serato'] }, ['rekordbox', 'engine'])).toEqual([
      'serato',
      'rekordbox',
      'engine',
    ])
    expect(withPrograms({}, ['engine', 'rekordbox'])).toEqual(['engine', 'rekordbox'])
  })

  it('leaves the track it reads from untouched', () => {
    const track = { programs: ['rekordbox' as const] }
    withPrograms(track, ['serato'])
    expect(track.programs).toEqual(['rekordbox'])
  })
})
