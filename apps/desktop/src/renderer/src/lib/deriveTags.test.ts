import { describe, expect, it } from 'vitest'
import { deriveTagPatches, deriveTags, smartDeriveTags } from './deriveTags'

describe('deriveTags', () => {
  it('composes the accents a macOS file name stores decomposed, so they land in the tag as one letter', () => {
    const tags = deriveTags('Mötörhead - Ace Of Spades.flac'.normalize('NFD'), '{artist} - {title}')
    expect(tags.artist).toBe('Mötörhead'.normalize('NFC'))
  })

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

  it('reads a zero-padded space-separated track number', () => {
    expect(smartDeriveTags('04 kumara - snap.flac')).toEqual({
      trackNumber: '04',
      artist: 'kumara',
      title: 'snap',
    })
  })

  // A bare-space leading number is ambiguous: "04 Artist" is a padded track number, but
  // "4 Strings" / "808 State" / "50 Cent" are numeric artist names. Only the zero-padded
  // form (no artist starts with a leading zero) is read as a track number; an unpadded one
  // stays part of the artist so the Discogs query keeps the real act.
  it('keeps an unpadded leading number as part of a numeric artist name', () => {
    expect(smartDeriveTags('4 Strings - Day Time (String Remix).flac')).toEqual({
      artist: '4 Strings',
      title: 'Day Time (String Remix)',
    })
  })

  it('falls back to plain Artist - Title and never mistakes the artist for a number', () => {
    // The digit-only track number is what stops "A - B - C" reading "A" as a track number.
    expect(smartDeriveTags('A - B - C.flac')).toEqual({ artist: 'A', title: 'B - C' })
  })

  // The editor hands over names already stripped of their extension; treating the
  // last dot as one would eat a dotted artist ("Acer vs. The Beeper") instead.
  it('does not eat a dotted artist when the name carries no extension', () => {
    expect(smartDeriveTags('Acer vs. The Beeper - Keep Calm')).toEqual({
      artist: 'Acer vs. The Beeper',
      title: 'Keep Calm',
    })
  })

  // Bandcamp names every track of a download "Artist - Album - NN Title". Read as plain
  // "Artist - Title", the album and the number landed in the title, so the precise
  // artist+title search could never hit and every Bandcamp download ran the whole slow
  // fallback ladder against Discogs.
  it('reads the Bandcamp download name "Artist - Album - NN Title"', () => {
    expect(smartDeriveTags('Kolter - Hot Mess - 02 Hot Mess (Dub).wav')).toEqual({
      artist: 'Kolter',
      album: 'Hot Mess',
      trackNumber: '02',
      title: 'Hot Mess (Dub)',
    })
  })

  it('keeps an album that has its own dashes and drops the artist the title repeats', () => {
    expect(
      smartDeriveTags(
        'Javier Fig - Javier Fig - Fast Food - Slow Kids - 03 Javier Fig - Fast Food.wav',
      ),
    ).toEqual({
      artist: 'Javier Fig',
      album: 'Javier Fig - Fast Food - Slow Kids',
      trackNumber: '03',
      title: 'Fast Food',
    })
  })

  // Bandcamp always pads to two digits; anything else after the last dash is part of a
  // title ("99 Luftballons", "1999"), not a track number.
  it('does not read a title that starts with a number as a Bandcamp track number', () => {
    expect(smartDeriveTags('Nena - Live - 1999 Mix.flac')).toEqual({
      artist: 'Nena',
      title: 'Live - 1999 Mix',
    })
  })

  it('returns nothing when no common naming fits', () => {
    expect(smartDeriveTags('noseparator.flac')).toEqual({})
  })

  it('reads scene-style underscore names ("artist_-_title")', () => {
    // Many rips use underscores for spaces and "_-_" for the artist/title dash.
    expect(smartDeriveTags('rank_1_-_airwave.flac')).toEqual({
      artist: 'rank 1',
      title: 'airwave',
    })
  })

  it('reads an en/em dash used as the separator', () => {
    expect(smartDeriveTags('Rank 1 – Airwave.flac')).toEqual({ artist: 'Rank 1', title: 'Airwave' })
    expect(smartDeriveTags('Rank 1 — Airwave.flac')).toEqual({ artist: 'Rank 1', title: 'Airwave' })
  })

  it('still keeps a normal "Artist - Title" name untouched', () => {
    // The underscore handling must not fire on names that already use spaces.
    expect(smartDeriveTags('Above & Beyond - Sun In Your Eyes.flac')).toEqual({
      artist: 'Above & Beyond',
      title: 'Sun In Your Eyes',
    })
  })
})

describe('deriveTagPatches', () => {
  // The shared batch form all three fill-from-name entry points use: only tracks whose
  // names matched a pattern yield a patch, so applying it never blanks a non-matching row.
  it('returns one patch per derivable track and drops the rest', () => {
    const patches = deriveTagPatches([
      { id: 'a', fileName: 'ATB - Till I Come.wav' },
      { id: 'b', fileName: 'untitled.wav' },
    ])
    expect(patches).toHaveLength(1)
    expect(patches[0].id).toBe('a')
    expect(patches[0].meta).toMatchObject({ artist: 'ATB', title: 'Till I Come' })
  })
})
