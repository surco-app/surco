import { describe, expect, it } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import {
  buildAddScript,
  buildLibraryDumpScript,
  buildRevealScript,
  buildUpdateScript,
  isAppleMusicOnly,
  parseLibraryDump,
  shouldAddToAppleMusic,
} from './applemusic'

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

  it('returns the persistent ID of the imported track, the handle that later lets the app update or reveal this exact library copy instead of re-adding a duplicate', () => {
    const script = buildAddScript('/x.aiff', base)
    expect(script).toContain('return persistent ID of theTrack')
  })

  it('writes the comment verbatim, never auto-prepending the key: the library must show exactly what the user typed, and whoever wants the key visible in Music inserts it into the comment field (the field-insert menu), which reaches the file tag too', () => {
    const script = buildAddScript('/x.aiff', { ...base, key: '8A', comment: 'clean intro' })
    expect(script).toContain('set comment of theTrack to "clean intro"')
    expect(script).not.toContain('8A')
  })
})

describe('buildUpdateScript', () => {
  it('targets the library copy by persistent ID and reports "missing" instead of erroring when the user deleted it from Music, so the caller can fall back to a fresh add', () => {
    const script = buildUpdateScript('ABCD1234', base)
    expect(script).toContain(
      'set theMatches to (every track of library playlist 1 whose persistent ID is "ABCD1234")',
    )
    expect(script).toContain('if (count of theMatches) is 0 then return "missing"')
    expect(script).toContain('return persistent ID of theTrack')
  })

  it('writes empty text fields too, unlike the add: a sync must clear values the user removed in the editor, or stale tags linger in the library forever', () => {
    const script = buildUpdateScript('ABCD1234', base)
    expect(script).toContain('set comment of theTrack to ""')
    expect(script).toContain('set name of theTrack to "ATB (Till I Come)"')
  })

  it('clears numeric fields with 0 — Music shows 0 as empty — so a year the user removed does not survive the sync', () => {
    const script = buildUpdateScript('ABCD1234', { ...base, bpm: '128' })
    expect(script).toContain('set year of theTrack to 0')
    expect(script).toContain('set bpm of theTrack to 128')
  })

  it('rewrites the artwork when a cover is supplied and leaves it alone otherwise', () => {
    const withCover = buildUpdateScript('ABCD1234', base, '/tmp/cover.jpg')
    expect(withCover).toContain(
      'set data of artwork 1 of theTrack to (read (POSIX file "/tmp/cover.jpg") as picture)',
    )
    expect(buildUpdateScript('ABCD1234', base)).not.toContain('artwork')
  })
})

describe('buildRevealScript', () => {
  it('reveals the library copy by persistent ID and brings Music to the front, failing loud when the track is no longer in the library', () => {
    const script = buildRevealScript('ABCD1234')
    expect(script).toContain(
      'set theMatches to (every track of library playlist 1 whose persistent ID is "ABCD1234")',
    )
    expect(script).toContain('if (count of theMatches) is 0 then error')
    expect(script).toContain('reveal item 1 of theMatches')
    expect(script).toContain('activate')
  })
})

describe('buildLibraryDumpScript', () => {
  it('reads name and artist of every library track as lists, not one track at a time, so a multi-thousand-track library dumps in one fast pass instead of N AppleScript round-trips', () => {
    const script = buildLibraryDumpScript()
    expect(script).toContain('name of every track of library playlist 1')
    expect(script).toContain('artist of every track of library playlist 1')
  })

  it('joins each name and artist with a tab and the rows with linefeeds so the renderer can split the snapshot back into pairs', () => {
    const script = buildLibraryDumpScript()
    // Building a list with `set end of` then coercing once is O(n); string concat in
    // the loop would be O(n²) and stall on a big library.
    expect(script).toContain('set end of out to')
    expect(script).toContain("set AppleScript's text item delimiters to linefeed")
    expect(script).toContain('return out as text')
  })
})

describe('parseLibraryDump', () => {
  it('splits the tab-and-linefeed snapshot into title/artist pairs', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\nSorrow Town\tAlfredo Pareja\n')).toEqual([
      { title: 'Strobe', artist: 'deadmau5' },
      { title: 'Sorrow Town', artist: 'Alfredo Pareja' },
    ])
  })

  it('keeps the rest of the line as the artist so an artist that itself contains a tab is not truncated', () => {
    expect(parseLibraryDump('Title\tA, B\tC')).toEqual([{ title: 'Title', artist: 'A, B\tC' }])
  })

  it('skips blank and malformed rows (a trailing newline, or a line without a tab) rather than emitting empty pairs that would match everything', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\n\nNoTabLine\n')).toEqual([
      { title: 'Strobe', artist: 'deadmau5' },
    ])
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

describe('isAppleMusicOnly', () => {
  it('is true only when the track is added to Apple Music and the user opted out of keeping a copy', () => {
    expect(isAppleMusicOnly(true, false, 'darwin', 'aiff', false)).toBe(true)
    // Keeping the copy ("both") writes to the output folder as usual.
    expect(isAppleMusicOnly(true, true, 'darwin', 'aiff', false)).toBe(false)
  })

  it('keeps the copy when nothing is added to Apple Music, so a conversion never ends with no file at all', () => {
    // Setting off, non-macOS, and FLAC each mean no Apple Music add — the output
    // folder is then the only place the file lives, so it must be kept.
    expect(isAppleMusicOnly(false, false, 'darwin', 'aiff', false)).toBe(false)
    expect(isAppleMusicOnly(true, false, 'win32', 'aiff', false)).toBe(false)
    expect(isAppleMusicOnly(true, false, 'darwin', 'flac', false)).toBe(false)
  })

  it('never drops an in-place rewrite, which edits the user’s own source file rather than a fresh copy', () => {
    expect(isAppleMusicOnly(true, false, 'darwin', 'aiff', true)).toBe(false)
  })
})
