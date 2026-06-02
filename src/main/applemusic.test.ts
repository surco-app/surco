import { describe, it, expect } from 'vitest'
import { buildAddScript } from './applemusic'
import { TrackMetadata } from '../shared/types'

const base: TrackMetadata = {
  title: 'ATB (Till I Come)',
  artist: 'Tom Hafman',
  album: 'ATB / Verano Sin Azul',
  albumArtist: 'Tom Hafman, Gigi Pussy',
  year: '',
  genre: 'Electronic',
  grouping: 'Bases',
  comment: '',
  trackNumber: ''
}

describe('buildAddScript', () => {
  it('retries property writes so the paramErr (-50) raised while Apple Music is still importing does not abort the add', () => {
    const script = buildAddScript('/Users/vicent/Music/Surco/track.aiff', base)
    // The retry loop is the whole point: without it, setting properties on a
    // track that is mid-import throws -50 and the track lands untagged.
    expect(script).toContain('repeat 100 times')
    expect(script).toContain('on error errMsg number errNum')
    expect(script).toContain('if errNum is not -50 then error errMsg number errNum')
    expect(script).toContain('delay 0.1')
  })

  it('fails loud when the track never becomes writable instead of silently leaving it untagged', () => {
    const script = buildAddScript('/x.aiff', base)
    expect(script).toContain('if not metaSet then error')
  })

  it('adds the file via POSIX path and writes only the fields that have values', () => {
    const script = buildAddScript('/Users/vicent/Music/Surco/track.aiff', base)
    expect(script).toContain('set theTrack to add POSIX file "/Users/vicent/Music/Surco/track.aiff"')
    expect(script).toContain('set name of theTrack to "ATB (Till I Come)"')
    expect(script).toContain('set album of theTrack to "ATB / Verano Sin Azul"')
    expect(script).not.toContain('set comment of theTrack')
    expect(script).not.toContain('set year of theTrack')
  })

  it('writes numeric fields unquoted only when they are a positive number', () => {
    const withYear = buildAddScript('/x.aiff', { ...base, year: '1999', trackNumber: '0' })
    expect(withYear).toContain('set year of theTrack to 1999')
    expect(withYear).not.toContain('set track number of theTrack')
  })
})
