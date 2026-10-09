import { describe, expect, it, vi } from 'vitest'
import type { TrackMetadata } from '../shared/types'
import {
  buildAddScript,
  buildDeleteScript,
  buildFileLocationsScript,
  buildFileNamesScript,
  buildLibraryDumpScript,
  buildLocationScript,
  buildMusicRunningScript,
  buildPlaylistTransferScript,
  buildRevealScript,
  buildReviewDumpScript,
  buildSetFieldScript,
  buildUpdateScript,
  entriesForPaths,
  isAppleMusicOnly,
  musicFileEntries,
  parseFileLocations,
  parseFileNames,
  parseLibraryDump,
  parseReviewDump,
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

  it('widens the AppleEvent timeout so a slow import of a long track does not abort with -1712', () => {
    // A long extended-mix AIFF plus its artwork can take longer than the default
    // ~120s AppleEvent timeout to import, aborting a track that would have imported
    // fine. The add/write block must sit inside a widened `with timeout` for that not
    // to be a spurious failure.
    const script = buildAddScript('/x.aiff', base, '/tmp/cover.jpg')
    expect(script).toContain('with timeout of 300 seconds')
    expect(script).toContain('end timeout')
    const addAt = script.indexOf('add POSIX file')
    const timeoutAt = script.indexOf('with timeout of 300 seconds')
    const endTimeoutAt = script.indexOf('end timeout')
    // The import and every property write must be inside the widened window.
    expect(timeoutAt).toBeLessThan(addAt)
    expect(addAt).toBeLessThan(endTimeoutAt)
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
    // The recovery block above the loop has its own `exit repeat`, so look for the
    // one belonging to the 600-times property loop.
    const exitRepeat = script.indexOf('exit repeat', repeatStart)
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

  // macOS 26 (Tahoe) broke Music's `add`: it can execute without error, import
  // nothing and return nothing — which leaves theTrack UNDEFINED (AppleScript wipes
  // the variable when a command returns no result, even if pre-initialized) and the
  // first later reference aborts with the cryptic "-2753 theTrack is not defined"
  // users saw in the footer. The script must detect that state itself.
  it('guards the add result so a Tahoe no-op add cannot abort with -2753', () => {
    const script = buildAddScript('/x.aiff', base)
    expect(script).toContain('set gotTrack to true')
    expect(script).toContain('if theTrack is missing value then set gotTrack to false')
    expect(script).toContain('on error')
    expect(script).toContain('set gotTrack to false')
    const addAt = script.indexOf('add POSIX file')
    const guardAt = script.indexOf('set gotTrack to true')
    const repeatAt = script.indexOf('repeat 600 times')
    expect(addAt).toBeLessThan(guardAt)
    expect(guardAt).toBeLessThan(repeatAt)
  })

  // The other documented Tahoe variant: the import lands (sometimes late) but the
  // reference never comes back. Failing there would make the user retry and import a
  // duplicate, so the script first polls for the copy the import just created —
  // matched by the tags the converted file carries and bounded to entries added
  // after this run started, so an older same-titled library copy is never grabbed.
  it('recovers the imported track by title, artist and date added when the add returns nothing', () => {
    const script = buildAddScript('/x.aiff', base)
    expect(script).toContain('set importStarted to (current date) - 2')
    expect(script).toContain(
      'whose name is "ATB (Till I Come)" and artist is "Tom Hafman" and date added is greater than or equal to importStarted',
    )
    expect(script).toContain('set theTrack to item 1 of theMatches')
    const importStartedAt = script.indexOf('set importStarted')
    const addAt = script.indexOf('add POSIX file')
    expect(importStartedAt).toBeLessThan(addAt)
  })

  // Without a title or artist there is nothing safe to match a recovery against —
  // a bare `whose date added` sweep could adopt any track another app imported.
  it('skips the recovery lookup when the metadata carries no title or artist', () => {
    const script = buildAddScript('/x.aiff', { ...base, artist: '' })
    expect(script).not.toContain('importStarted')
    expect(script).toContain('if not gotTrack then error')
  })

  it('fails with a clear macOS 26 message instead of -2753 when the import never lands', () => {
    const script = buildAddScript('/x.aiff', base)
    expect(script).toContain('if not gotTrack then error "Música no importó el archivo')
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

describe('buildDeleteScript', () => {
  it('locates the copy by persistent ID, reports "missing" instead of erroring when it is gone, and returns the file location so the caller can trash it', () => {
    const script = buildDeleteScript('ABCD1234ABCD1234', 'Djmofly - Save My Love (26 Rmx)')
    expect(script).toContain(
      'set theMatches to (every track of library playlist 1 whose persistent ID is "ABCD1234ABCD1234")',
    )
    expect(script).toContain('if (count of theMatches) is 0 then return "missing"')
    expect(script).toContain('POSIX path of (location of theTrack)')
    expect(script).toContain('delete theTrack')
  })

  it('reads the location before deleting, inside a try so a track without a file still deletes', () => {
    const script = buildDeleteScript('ABCD1234ABCD1234', 'Djmofly - Save My Love (26 Rmx)')
    expect(script.indexOf('location of theTrack')).toBeLessThan(script.indexOf('delete theTrack'))
    expect(script.indexOf('try')).toBeLessThan(script.indexOf('location of theTrack'))
  })

  // The persistent ID comes from a library snapshot whose four whole-library fetches can
  // misalign if Music mutates mid-dump — an ID paired with the wrong song. The script is
  // the last line of defense: it must compare the live track's own artist/name against
  // the label the user confirmed and refuse to delete anything else.
  it('verifies the live track matches the confirmed label before deleting, and bails as "mismatch" without deleting otherwise', () => {
    const script = buildDeleteScript('ABCD1234ABCD1234', 'Djmofly - Save My Love (26 Rmx)')
    expect(script).toContain('artist of theTrack')
    expect(script).toContain('name of theTrack')
    expect(script).toContain('"Djmofly - Save My Love (26 Rmx)"')
    expect(script).toContain('return "mismatch"')
    expect(script.indexOf('return "mismatch"')).toBeLessThan(script.indexOf('delete theTrack'))
  })
})

describe('buildLocationScript', () => {
  // "Apple Music only" deletes its temp conversion after the add — safe only if Music
  // copied the file into its Media folder. This script reads where the fresh entry
  // actually points so the caller can tell a copy from a reference to the temp path.
  it('returns the entry file path, empty when the entry holds no reachable file', () => {
    const script = buildLocationScript('ABCD1234ABCD1234')
    expect(script).toContain('whose persistent ID is "ABCD1234ABCD1234"')
    expect(script).toContain('return ""')
  })

  // Measured against a real library 14/09: inside the tell block the coercion raises, the
  // try swallows it and the script returns empty for a track that is plainly there — which
  // left replacesPath empty, so rekordbox was never told which file the conversion
  // superseded and stayed pointing at the old MP3. The alias has to leave the tell block
  // before POSIX path touches it.
  it('coerces the location outside the Music tell block', () => {
    const script = buildLocationScript('ABCD1234ABCD1234')
    const tellBody = script.slice(script.indexOf('tell application'), script.indexOf('end tell'))

    expect(tellBody).not.toContain('POSIX path')
    expect(script).toContain('POSIX path')
  })
})

describe('buildLibraryDumpScript', () => {
  it('reads name and artist of every library track as lists, not one track at a time, so a multi-thousand-track library dumps in one fast pass instead of N AppleScript round-trips', () => {
    const script = buildLibraryDumpScript()
    expect(script).toContain('name of every track of library playlist 1')
    expect(script).toContain('artist of every track of library playlist 1')
  })

  it('also reads each track duration as a list so the matcher can tell two versions of one title apart by length', () => {
    const script = buildLibraryDumpScript()
    expect(script).toContain('duration of every track of library playlist 1')
  })

  it('also reads each track persistent ID so a matched entry can later be updated or deleted, not just detected', () => {
    const script = buildLibraryDumpScript()
    expect(script).toContain('persistent ID of every track of library playlist 1')
  })

  // Measured on macOS 26.5.2: with Music running and `library playlist 1` existing,
  // `count of tracks` returns 0 cleanly but `name of every track` raises "Can't get name
  // of every track of library playlist 1. (-1728)": AppleScript will not coerce an empty
  // list of properties. An empty library is an ordinary state (a fresh Mac, a library on a
  // disconnected external drive), so the dump has to read as zero tracks, not as a failure:
  // without this the snapshot never lands and every track silently loses its "already in
  // your library" verdict. `exists library playlist 1` does NOT catch this: it is true.
  it('returns nothing instead of reading the track lists when the library is empty, because asking for a property of every track of an empty library is what raises -1728', () => {
    const script = buildLibraryDumpScript()
    const guard = script.indexOf('count of tracks of library playlist 1')
    expect(guard).toBeGreaterThanOrEqual(0)
    expect(script).toMatch(/if \(count of tracks of library playlist 1\) is 0 then return ""/)
    expect(guard).toBeLessThan(script.indexOf('name of every track of library playlist 1'))
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
  it('splits a title/artist/duration row into a candidate with its length in seconds', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\t634\nSorrow Town\tAlfredo Pareja\t245\n')).toEqual([
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634 },
      { title: 'Sorrow Town', artist: 'Alfredo Pareja', durationSec: 245 },
    ])
  })

  it('parses a comma-decimal duration (an es-locale AppleScript serialises 486.55 as "486,55") and rounds to whole seconds', () => {
    expect(parseLibraryDump('Funky Feelings\tHead Horny\t486,555999755859')).toEqual([
      { title: 'Funky Feelings', artist: 'Head Horny', durationSec: 487 },
    ])
  })

  it('parses a dot-decimal duration and rounds to whole seconds', () => {
    expect(parseLibraryDump('Track\tArtist\t367.2')).toEqual([
      { title: 'Track', artist: 'Artist', durationSec: 367 },
    ])
  })

  it('peels the duration off the last tab only when it is a number, so an artist that itself contains a tab is not truncated and gains no bogus duration', () => {
    // The trailing field "C" is not numeric, so the whole remainder stays the artist.
    expect(parseLibraryDump('Title\tA, B\tC')).toEqual([{ title: 'Title', artist: 'A, B\tC' }])
  })

  it('keeps a row whose duration is missing or unparseable as a plain title/artist pair rather than dropping it', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5')).toEqual([{ title: 'Strobe', artist: 'deadmau5' }])
  })

  it('skips blank and malformed rows (a trailing newline, or a line without a tab) rather than emitting empty pairs that would match everything', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\t634\n\nNoTabLine\n')).toEqual([
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634 },
    ])
  })

  it('peels a trailing persistent ID off the row so the entry can later be deleted or revealed, keeping the duration parse intact', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\t634\t9F1B7C2D8E3A4F50')).toEqual([
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634, persistentId: '9F1B7C2D8E3A4F50' },
    ])
    // es-locale comma decimal still parses with the ID behind it.
    expect(parseLibraryDump('Funky Feelings\tHead Horny\t486,55\tA0B1C2D3E4F56789')).toEqual([
      {
        title: 'Funky Feelings',
        artist: 'Head Horny',
        durationSec: 487,
        persistentId: 'A0B1C2D3E4F56789',
      },
    ])
  })

  it('keeps a row without a persistent ID a plain candidate, so an old-shape dump still parses', () => {
    expect(parseLibraryDump('Strobe\tdeadmau5\t634')).toEqual([
      { title: 'Strobe', artist: 'deadmau5', durationSec: 634 },
    ])
  })

  it('never mistakes an artist tail for a persistent ID: only a 16-hex-uppercase last field is peeled', () => {
    // The trailing field is not a pid nor a number, so it stays part of the artist.
    expect(parseLibraryDump('Title\tA, B\tC0FFEE')).toEqual([
      { title: 'Title', artist: 'A, B\tC0FFEE' },
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
    expect(isAppleMusicOnly(true, false, false, 'darwin', 'aiff', false)).toBe(true)
    // Keeping the copy ("both") writes to the output folder as usual.
    expect(isAppleMusicOnly(true, true, false, 'darwin', 'aiff', false)).toBe(false)
  })

  it('keeps the copy when nothing is added to Apple Music, so a conversion never ends with no file at all', () => {
    // Setting off, non-macOS, and FLAC each mean no Apple Music add — the output
    // folder is then the only place the file lives, so it must be kept.
    expect(isAppleMusicOnly(false, false, false, 'darwin', 'aiff', false)).toBe(false)
    expect(isAppleMusicOnly(true, false, false, 'win32', 'aiff', false)).toBe(false)
    expect(isAppleMusicOnly(true, false, false, 'darwin', 'flac', false)).toBe(false)
  })

  // Engine DJ's library references the output copy, so dropping it would leave that
  // library pointing at a file that is gone.
  it('keeps the copy when Engine DJ registers the conversion', () => {
    expect(isAppleMusicOnly(true, false, true, 'darwin', 'aiff', false)).toBe(false)
  })

  it('never drops an in-place rewrite, which edits the user’s own source file rather than a fresh copy', () => {
    expect(isAppleMusicOnly(true, false, false, 'darwin', 'aiff', true)).toBe(false)
  })
})

// Music's year property is an integer: "set year of theTrack to 2020-12-01" is not even
// valid AppleScript, so the add would fail outright.
describe('buildAddScript with a full release date', () => {
  it('sets only the year', () => {
    const script = buildAddScript('/x.aiff', { ...base, year: '2020-12-01' })
    expect(script).toContain('set year of theTrack to 2020\n')
  })
})

describe('parseReviewDump', () => {
  const RS = '\u001e'
  const FS = '\u001f'
  const row = (...f: string[]) => f.join(FS)
  const wallClock = (y: number, mo: number, d: number, h: number, mi: number, s: number) => {
    const secs = (Date.UTC(y, mo, d, h, mi, s) - Date.UTC(2001, 0, 1)) / 1000
    return `${Math.floor(secs / 86400)}:${secs % 86400}`
  }

  it('reads every field of a file track, with the duration Music prints in a comma locale', () => {
    const out = parseReviewDump(
      `${row('6E592CFE07A6246A', 'Bleeding Love', 'DJ Lara, DJ Sergi Val', 'DJ Lara', 'Bleeding Love', 'Electronic', '384,26', '')}\n`,
    )
    expect(out).toEqual([
      {
        persistentId: '6E592CFE07A6246A',
        title: 'Bleeding Love',
        artist: 'DJ Lara, DJ Sergi Val',
        albumArtist: 'DJ Lara',
        album: 'Bleeding Love',
        genre: 'Electronic',
        durationSec: 384,
      },
    ])
  })

  // The whole point of the review is the value exactly as Music holds it: a trailing
  // space or an invisible character is a finding, so nothing may be trimmed away.
  it('keeps invisible characters, tabs and spaces inside a value', () => {
    const [e] = parseReviewDump(
      row(
        '5FA52DD35E307CBB',
        'Funk\tFreak ',
        'Aar\u200b\u00f3\u200bn Alfonso',
        '',
        '',
        '',
        '419',
        '',
      ),
    )
    expect(e.title).toBe('Funk\tFreak ')
    expect(e.artist).toBe('Aar\u200b\u00f3\u200bn Alfonso')
  })

  it('splits rows on the record separator, not on line breaks a title may hold', () => {
    const out = parseReviewDump(
      [
        row('0000000000000001', 'A\nB', 'X', '', '', '', '1', ''),
        row('0000000000000002', 'C', 'Y', '', '', '', '2', ''),
      ].join(RS),
    )
    expect(out.map((e) => e.title)).toEqual(['A\nB', 'C'])
  })

  it('drops a row that is not eight fields or has no persistent ID', () => {
    expect(parseReviewDump(row('nope', 'A', 'B', '', '', '', '1', ''))).toEqual([])
    expect(parseReviewDump(row('0000000000000001', 'A'))).toEqual([])
  })

  // Music prints dates in the system locale, so the script sends wall-clock seconds from a
  // fixed local epoch and the parser turns them back into the date Music shows.
  it('reads the date added as the local wall-clock time Music holds', () => {
    const [e] = parseReviewDump(
      row('0000000000000001', 'A', 'X', '', '', '', '1', wallClock(2026, 8, 25, 8, 47, 13)),
    )
    expect(e.dateAdded).toBe(new Date(2026, 8, 25, 8, 47, 13).toISOString())
  })

  it('leaves the date added out when Music gave none', () => {
    const [e] = parseReviewDump(row('0000000000000001', 'A', 'X', '', '', '', '1', ''))
    expect(e.dateAdded).toBeUndefined()
  })

  it('reads an empty library as no entries', () => {
    expect(parseReviewDump('')).toEqual([])
    expect(parseReviewDump('\n')).toEqual([])
  })
})

describe('buildReviewDumpScript', () => {
  // Only file tracks can be fixed on disk, and asking an empty library for a property of
  // every track raises -1728 (see buildLibraryDumpScript), so the count guards first.
  it('reads file tracks only and returns nothing for an empty library', () => {
    const script = buildReviewDumpScript()
    expect(script).toContain('if (count of file tracks of library playlist 1) is 0 then return ""')
    expect(script).toContain('album artist of every file track of library playlist 1')
    expect(script).not.toMatch(/of every track of/)
  })

  // Dates as text follow the system locale; whole numbers do not, and they stay small
  // because AppleScript turns integers past 2^29 into locale-formatted reals.
  it('sends the date added as days and seconds from a fixed epoch, never as locale text', () => {
    const script = buildReviewDumpScript()
    expect(script).toContain('date added of every file track of library playlist 1')
    expect(script).toContain('set year of epochRef to 2001')
    expect(script).toContain('(x div 86400) as integer as text')
    expect(script).toContain('(x mod 86400) as integer as text')
    expect(script).not.toMatch(/date added.* as text/)
  })
})

describe('buildSetFieldScript', () => {
  it('maps the field onto the Music property and guards on the value the review read', () => {
    const script = buildSetFieldScript('6E592CFE07A6246A', 'albumArtist', 'Dj Lara', 'DJ Lara')
    expect(script).toContain('whose persistent ID is "6E592CFE07A6246A"')
    expect(script).toContain(
      'if (album artist of theTrack) is not "Dj Lara" then return "mismatch"',
    )
    expect(script).toContain('set album artist of theTrack to "DJ Lara"')
  })

  // AppleScript compares text ignoring case by default, so "Dj Lara" would pass a guard
  // reading "DJ Lara". The review's whole job is the case, so the guard must not ignore it.
  it('compares the current value exactly, case and accents included', () => {
    const script = buildSetFieldScript('6E592CFE07A6246A', 'artist', 'Dj Lara', 'DJ Lara')
    expect(script).toContain('considering case, diacriticals, hyphens, punctuation and white space')
  })

  it('writes the title through the name property', () => {
    expect(buildSetFieldScript('6E592CFE07A6246A', 'title', 'a', 'b')).toContain(
      'set name of theTrack to "b"',
    )
  })
})

describe('buildPlaylistTransferScript', () => {
  it('adds the kept copy to plain playlists only and checks the label first', () => {
    const s = buildPlaylistTransferScript(
      'OLD0000000000000',
      'KEEP000000000000',
      'A - B',
      'A - B (X)',
    )
    expect(s).toContain(
      'if (artist of src) & " - " & (name of src) is not "A - B" then return "mismatch"',
    )
    expect(s).toContain('every user playlist whose smart is false and special kind is none')
    expect(s).toContain(
      'if (artist of dst) & " - " & (name of dst) is not "A - B (X)" then return "mismatch"',
    )
    expect(s).toContain('duplicate dst to (contents of p)')
    expect(s).toContain('return (moved as text) & tab & (failed as text)')
  })
})

describe('Music entries for loaded files', () => {
  const RS = '\u001e'
  const FS = '\u001f'
  const row = (...f: string[]) => f.join(FS)
  const PID = '6E592CFE07A6246A'
  const OTHER = '5FA52DD35E307CBB'

  it('reads each file track name with the label the scripts check', () => {
    expect(
      parseFileNames([row(PID, 'DJ Ter', 'This Rap'), row('nope', 'A', 'B')].join(RS)),
    ).toEqual([{ persistentId: PID, name: 'This Rap', label: 'DJ Ter - This Rap' }])
  })

  it('reads locations and drops tracks whose file is missing', () => {
    expect(parseFileLocations([row(PID, '/m/a.aiff'), row(OTHER, '')].join(RS))).toEqual([
      { persistentId: PID, path: '/m/a.aiff' },
    ])
  })

  // The NAS stores names decomposed while Surco works composed (entryForFile), and a file
  // Music holds twice must come back as two entries so the review can refuse to guess.
  it('matches a loaded path composed and keeps every entry on the same file', () => {
    const composed = '/m/Caf\u00e9.aiff'
    const decomposed = '/m/Cafe\u0301.aiff'
    expect(decomposed).not.toBe(composed)
    const rows = [
      { persistentId: 'A', path: decomposed, label: 'X - Caf\u00e9' },
      { persistentId: 'B', path: decomposed, label: 'X - Caf\u00e9' },
      { persistentId: 'C', path: '/m/other.aiff', label: 'Y - Z' },
    ]
    expect(entriesForPaths(rows, [composed, '/m/none.aiff'])).toEqual({
      [composed]: [
        { persistentId: 'A', label: 'X - Caf\u00e9' },
        { persistentId: 'B', label: 'X - Caf\u00e9' },
      ],
    })
  })

  // A user who never uses Music would see it launch just because they reviewed a folder.
  it('does not open Music to ask unless told to', async () => {
    const run = vi.fn().mockResolvedValue('false\n')
    expect(await musicFileEntries([{ path: '/m/a.aiff', title: 'T' }], false, run)).toEqual({
      consulted: false,
      entries: {},
    })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe(buildMusicRunningScript())
  })

  // Locations cost 15 ms each on SMB, so only tracks named like a loaded title are asked.
  it('asks for the location of only the tracks named like a loaded title, ignoring case', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(
        [row(PID, 'A', 'Caf\u00e9 Mix'), row(OTHER, 'B', 'Unrelated')].join(RS),
      )
      .mockResolvedValueOnce(row(PID, '/m/a.aiff'))
    const out = await musicFileEntries(
      [
        { path: '/m/a.aiff', title: 'CAFE\u0301 mix' },
        { path: '/m/b.aiff', title: 'Other' },
      ],
      true,
      run,
    )
    expect(out).toEqual({
      consulted: true,
      entries: { '/m/a.aiff': [{ persistentId: PID, label: 'A - Caf\u00e9 Mix' }] },
    })
    expect(run.mock.calls[1][0]).toBe(buildFileLocationsScript([PID]))
  })

  it('asks an open Music without launching it and skips locations when no name matches', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce('true\n')
      .mockResolvedValueOnce(row(PID, 'A', 'Something else'))
    expect(await musicFileEntries([{ path: '/m/a.aiff', title: 'T' }], false, run)).toEqual({
      consulted: true,
      entries: {},
    })
    expect(run).toHaveBeenCalledTimes(2)
  })

  // Music raises -1728 on an empty library; that is an answer ("nothing here"), not a failure.
  it('treats an empty library as consulted with nothing found', async () => {
    const run = vi.fn().mockRejectedValue(new Error("Can't get name of every track. (-1728)"))
    expect(await musicFileEntries([{ path: '/m/a.aiff', title: 'T' }], true, run)).toEqual({
      consulted: true,
      entries: {},
    })
  })

  it('reports not consulted instead of rejecting when Music fails otherwise', async () => {
    const run = vi.fn().mockRejectedValue(new Error('Music got an error (-600)'))
    expect(await musicFileEntries([{ path: '/m/a.aiff', title: 'T' }], true, run)).toEqual({
      consulted: false,
      entries: {},
    })
  })

  it('reads the names in bulk and guards the empty library', () => {
    const script = buildFileNamesScript()
    expect(script).toContain('persistent ID of every file track of library playlist 1')
    expect(script).toContain('if (count of file tracks of library playlist 1) is 0 then return ""')
    expect(script).not.toContain('location')
  })

  // POSIX path is a system coercion: inside the tell block it yields "" for every track
  // (appleMusicPlaylists.ts), so the locations must leave it first.
  it('reads locations only for the wanted IDs and coerces them outside the tell block', () => {
    const script = buildFileLocationsScript([PID, OTHER])
    expect(script).toContain(`{"${PID}", "${OTHER}"}`)
    expect(script).toContain('location of item i of theTracks')
    expect(script.indexOf('POSIX path of loc')).toBeGreaterThan(script.indexOf('end tell'))
  })
})
