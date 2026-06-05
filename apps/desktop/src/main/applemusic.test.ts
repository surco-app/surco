import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import { buildAddScript, buildLookupScript, shouldAddToAppleMusic } from './applemusic'

const base: TrackMetadata = {
  title: 'ATB (Till I Come)',
  artist: 'Tom Hafman',
  album: 'ATB / Verano Sin Azul',
  albumArtist: 'Tom Hafman, Gigi Pussy',
  year: '',
  genre: 'Electronic',
  grouping: 'Bases',
  comment: '',
  trackNumber: '',
  discNumber: '',
  bpm: '',
  key: '',
  publisher: '',
  catalogNumber: '',
  remixArtist: '',
}

describe('buildAddScript', () => {
  it('retries property writes so the paramErr (-50) raised while Apple Music is still importing does not abort the add', () => {
    const script = buildAddScript('/Users/vicent/Music/Surco/track.aiff', base)
    // The retry loop is the whole point: without it, setting properties on a
    // track that is mid-import throws -50 and the track lands untagged. The
    // count times the delay is the patience window — it must outlast Music
    // copying a large file into the library, which a 10s window did not, so a
    // big extended-mix AIFF gave up and landed untagged.
    expect(script).toContain('repeat 600 times')
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
    expect(script).toContain(
      'set theTrack to add POSIX file "/Users/vicent/Music/Surco/track.aiff"',
    )
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

  it('writes the cover onto the Music track via AppleScript so it does not depend on the file carrying embedded art — the whole point for WAV, whose embedded artwork Music ignores', () => {
    const script = buildAddScript('/x.wav', base, '/tmp/cover.jpg')
    expect(script).toContain(
      'set data of artwork 1 of theTrack to (read (POSIX file "/tmp/cover.jpg") as picture)',
    )
  })

  it('does not touch artwork when there is no cover, leaving any existing artwork alone', () => {
    expect(buildAddScript('/x.aiff', base)).not.toContain('artwork')
  })

  it('retries the artwork write alongside the tags so the -50 raised mid-import does not drop the cover', () => {
    // The artwork set must sit inside the same retry loop as the properties;
    // outside it, a cover written while Music is still importing throws -50 and
    // the track lands without art
    const script = buildAddScript('/x.wav', base, '/tmp/cover.jpg')
    const repeatStart = script.indexOf('repeat 600 times')
    const artwork = script.indexOf('set data of artwork 1')
    const exitRepeat = script.indexOf('exit repeat')
    expect(repeatStart).toBeLessThan(artwork)
    expect(artwork).toBeLessThan(exitRepeat)
  })

  it('sets the Apple Music BPM and disc number, the only advanced tags Music can hold', () => {
    // key/publisher/catalog/remixer have no Music property, so they live only in
    // the file tag; bpm and disc number are scriptable and must reach Music
    const script = buildAddScript('/x.aiff', { ...base, bpm: '128', discNumber: '2' })
    expect(script).toContain('set bpm of theTrack to 128')
    expect(script).toContain('set disc number of theTrack to 2')
    expect(script).not.toContain('set bpm of theTrack to 0')
  })
})

describe('buildLookupScript', () => {
  it('counts library tracks matching both name and artist so a different song with the same title is not flagged as a duplicate', () => {
    const script = buildLookupScript('Tom Hafman', 'ATB (Till I Come)')
    // Querying library playlist 1 (not a specific source) is what scopes the
    // search to the user's whole library; matching name AND artist is what keeps
    // it from flagging unrelated songs that happen to share a title.
    expect(script).toContain('every track of library playlist 1 whose')
    expect(script).toContain('name is "ATB (Till I Come)"')
    expect(script).toContain('artist is "Tom Hafman"')
    expect(script).toContain('return (count of')
  })

  it('trims the values so trailing whitespace from the tag fields does not break the exact match Music performs', () => {
    const script = buildLookupScript('  Tom Hafman  ', '  ATB (Till I Come)  ')
    expect(script).toContain('name is "ATB (Till I Come)"')
    expect(script).toContain('artist is "Tom Hafman"')
  })
})

describe('shouldAddToAppleMusic', () => {
  it('refuses on non-darwin platforms even when the setting is enabled, because osascript and the Music AppleScript bridge only exist on macOS — a settings.json carried over to Windows must not spawn a missing binary', () => {
    expect(shouldAddToAppleMusic(true, 'win32', 'aiff')).toBe(false)
    expect(shouldAddToAppleMusic(true, 'linux', 'aiff')).toBe(false)
  })

  it('runs only when the user enabled it and the platform is macOS', () => {
    expect(shouldAddToAppleMusic(true, 'darwin', 'aiff')).toBe(true)
    expect(shouldAddToAppleMusic(false, 'darwin', 'aiff')).toBe(false)
  })

  it('refuses for FLAC even on macOS with the setting enabled, because Apple Music cannot ingest FLAC — adding the file would either fail or import nothing', () => {
    expect(shouldAddToAppleMusic(true, 'darwin', 'flac')).toBe(false)
  })
})
