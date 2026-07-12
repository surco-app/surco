import { describe, expect, it } from 'vitest'
import { parseFileName } from './filename'

describe('parseFileName', () => {
  it('splits artist and title on the first " - " so remix titles stay intact', () => {
    // matters because "Keep Calm (Beeper's Mix)" must not be cut, and the
    // artist drives an accurate Discogs query
    const r = parseFileName("/music/Acer vs. The Beeper - Keep Calm (Beeper's Mix).wav")
    expect(r.artist).toBe('Acer vs. The Beeper')
    expect(r.title).toBe("Keep Calm (Beeper's Mix)")
    expect(r.query).toBe("Acer vs. The Beeper Keep Calm (Beeper's Mix)")
  })

  it('keeps a hyphenated title whole when it contains a later " - "', () => {
    const r = parseFileName("/m/Artist - The Beat - Won't Stop.flac")
    expect(r.artist).toBe('Artist')
    expect(r.title).toBe("The Beat - Won't Stop")
  })

  it('falls back to the whole name as title when there is no separator', () => {
    // without an artist we still need a usable query and a sane title field
    const r = parseFileName('/m/Untitled Loop.wav')
    expect(r.artist).toBe('')
    expect(r.title).toBe('Untitled Loop')
    expect(r.query).toBe('Untitled Loop')
  })

  // The common DJ-rip namings carry a leading track number; importing it as part of
  // the artist ("104. Artist") poisons the field and the Discogs query. Import uses
  // the same auto-detection as the fill-from-filename button, so the two can't drift.
  it('strips a leading track number from the artist, like fill-from-filename does', () => {
    const r = parseFileName('/m/104. Artist - Title.aiff')
    expect(r.artist).toBe('Artist')
    expect(r.title).toBe('Title')
    expect(r.query).toBe('Artist Title')
  })

  it('reads the numbered "NN - Artist - Title" shape the same way', () => {
    const r = parseFileName('/m/07 - Artist - Title.flac')
    expect(r.artist).toBe('Artist')
    expect(r.title).toBe('Title')
  })

  // A numeric-prefixed act ("4 Strings") must not be read as a track number + "Strings", or
  // the Discogs query loses the real artist and returns unrelated releases.
  it('keeps a numeric artist prefix out of the track number so the query stays accurate', () => {
    const r = parseFileName('/m/4 Strings - Day Time (String Remix).flac')
    expect(r.artist).toBe('4 Strings')
    expect(r.title).toBe('Day Time (String Remix)')
    expect(r.query).toBe('4 Strings Day Time (String Remix)')
  })

  it('strips the extension and directory from the file name', () => {
    const r = parseFileName('/a/b/Chumi Dj - Open Your Eyes.wav')
    expect(r.fileName).toBe('Chumi Dj - Open Your Eyes')
  })

  // Windows paths arrive with backslashes; splitting on '/' alone left the whole
  // route as the track's label and search query (reported by a Windows user twice).
  it('strips a backslashed Windows directory the same way', () => {
    const r = parseFileName('C:\\Users\\Djotas\\Música\\Chumi Dj - Open Your Eyes.wav')
    expect(r.fileName).toBe('Chumi Dj - Open Your Eyes')
    expect(r.query).toBe('Chumi Dj Open Your Eyes')
  })
})
