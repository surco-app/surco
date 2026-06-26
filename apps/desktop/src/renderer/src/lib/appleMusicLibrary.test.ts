import { describe, expect, it } from 'vitest'
import { buildLibraryIndex, isInLibrary } from './appleMusicLibrary'

describe('buildLibraryIndex / isInLibrary', () => {
  const index = buildLibraryIndex([
    { title: 'Strobe', artist: 'deadmau5' },
    { title: 'Sorrow Town (Phone On The Mix)', artist: 'Alfredo Pareja' },
    { title: 'Canción', artist: 'Estopa' },
  ])

  it('finds a song already in the library by exact title and primary artist', () => {
    expect(isInLibrary(index, { title: 'Strobe', artist: 'deadmau5' })).toBe(true)
  })

  it('misses a different song that merely shares the primary artist', () => {
    // A title the library does not hold must not be flagged just because the artist
    // matches — that is the whole point of keying on the title, so the user is not
    // told they already own a track they don't.
    expect(isInLibrary(index, { title: 'Some Other Track', artist: 'deadmau5' })).toBe(false)
  })

  it('matches an "&" collaboration whose library copy spells the co-artists shorter', () => {
    // Real case: the file tags the full collaboration ("Head Horny's & DJ Miguel Serna")
    // while Apple Music files it under a shorter spelling ("Head Horny's & Miguel Serna").
    // Requiring every candidate word ("dj") to appear would read it as not-owned, so we
    // keep only the lead artist before the "&" — still a subset of the library copy.
    const lib = buildLibraryIndex([{ title: 'Real', artist: "Head Horny's & Miguel Serna" }])
    expect(isInLibrary(lib, { title: 'Real', artist: "Head Horny's & DJ Miguel Serna" })).toBe(true)
  })

  it('matches on the first artist only so a feat./multi-artist tag still finds the library copy', () => {
    // Apple Music keeps only the primary artist ("Alfredo Pareja"), while our tags
    // join collaborators ("Alfredo Pareja, Saint Etien"); an exact-artist compare
    // would read every collaboration as "not in library".
    expect(
      isInLibrary(index, {
        title: 'Sorrow Town (Phone On The Mix)',
        artist: 'Alfredo Pareja, Saint Etien',
      }),
    ).toBe(true)
  })

  it('drops an inline "feat." clause from the candidate artist so a lead-artist library copy still matches', () => {
    // DJ tags often spell the featured act inline ("Ken Laszlo Feat. Jenny") while Apple
    // Music keeps only the lead ("Ken Laszlo"). With no comma to split on, requiring every
    // candidate word to appear would read the song as not-owned; dropping the feature
    // clause mirrors the comma case so the badge and the filter agree it is in the library.
    const feat = buildLibraryIndex([{ title: 'When I Fall In Love', artist: 'Ken Laszlo' }])
    expect(
      isInLibrary(feat, { title: 'When I Fall In Love', artist: 'Ken Laszlo Feat. Jenny' }),
    ).toBe(true)
  })

  it('folds case, accents and punctuation so spelling drift between the tag and the library still matches', () => {
    // foldText is the same canonical key the search and Discogs scorer use, so the
    // hint never disagrees with them on what counts as the same song.
    expect(isInLibrary(index, { title: 'cancion', artist: 'ESTOPA' })).toBe(true)
  })

  it('reports not-in-library for a title the library does not hold', () => {
    expect(isInLibrary(index, { title: 'Ghosts n Stuff', artist: 'deadmau5' })).toBe(false)
  })

  it('never matches on an empty title or artist, which would otherwise flag everything', () => {
    expect(isInLibrary(index, { title: '', artist: 'deadmau5' })).toBe(false)
    expect(isInLibrary(index, { title: 'Strobe', artist: '  ' })).toBe(false)
  })

  // Whole-word matching: a primary artist must not match a longer name it only sits
  // inside as a substring, or a same-titled song by a different artist reads as owned.
  it('does not match an artist that is only a substring of a longer library artist', () => {
    const idx = buildLibraryIndex([{ title: 'Together', artist: 'Matador' }])
    expect(isInLibrary(idx, { title: 'Together', artist: 'Mat' })).toBe(false)
    expect(isInLibrary(idx, { title: 'Together', artist: 'Matador' })).toBe(true)
  })

  // The library still wins when it carries extra words around the primary artist.
  it('matches when the library artist adds words around the primary name', () => {
    const idx = buildLibraryIndex([{ title: 'Anthem', artist: 'Alfredo Pareja & Friends' }])
    expect(isInLibrary(idx, { title: 'Anthem', artist: 'Alfredo Pareja' })).toBe(true)
  })

  // A dotted acronym ("DJ F.R.A.N.K.") folds to single letters; the tag often keeps it
  // solid ("DJ. Frank"). Collapsing a run of single letters makes the two spellings agree.
  it('matches a dotted-acronym library artist against its solid-spelled tag', () => {
    const idx = buildLibraryIndex([{ title: 'Dinner', artist: 'DJ F.R.A.N.K.' }])
    expect(isInLibrary(idx, { title: 'Dinner', artist: 'DJ. Frank' })).toBe(true)
  })

  // A digit and its spelled-out word are the same name ("A7" vs "A Seven"): split the
  // letter/digit run and read number words as digits so the two forms meet.
  it('matches a digit artist against its spelled-out number', () => {
    const idx = buildLibraryIndex([{ title: 'Piece Of Heaven', artist: 'A Seven' }])
    expect(isInLibrary(idx, { title: 'Piece Of Heaven', artist: 'A7' })).toBe(true)
    const back = buildLibraryIndex([{ title: 'Four To The Floor', artist: 'DJ4' }])
    expect(isInLibrary(back, { title: 'Four To The Floor', artist: 'DJ Four' })).toBe(true)
  })

  // The same name spelled with and without a space after a leading initial ("DSigual" tag
  // vs "D Sigual" library) is one artist — a rip glued the initial onto the next word. Spaces
  // are the only difference, so compare with all of them removed; still whole-letters, so it
  // can't fuse two genuinely different names.
  it('matches an artist whose only difference is a space after a leading initial', () => {
    const idx = buildLibraryIndex([{ title: 'Technobox', artist: 'D Sigual', durationSec: 375 }])
    expect(isInLibrary(idx, { title: 'Technobox', artist: 'DSigual', durationSec: 375 })).toBe(true)
  })

  // A "DJ"/"Dr."/"MC" handle is noise around the same act: "DJ Raúl Soto & DJ Jaime Gimeno"
  // (tag) is the "Raul Soto & Jaime Gimeno" the library files. Strip a leading handle so the
  // lead artist matches.
  it('strips a leading DJ/Dr./MC handle from the artist', () => {
    const idx = buildLibraryIndex([{ title: 'Poky Diablo', artist: 'Raul Soto & Jaime Gimeno' }])
    expect(
      isInLibrary(idx, { title: 'Poky Diablo', artist: 'DJ Raúl Soto & DJ Jaime Gimeno' }),
    ).toBe(true)
  })

  // And the other direction: the tag elaborates the act the library files under a shorter
  // name — a title prefix ("Dr. DJ Cerla" vs "DJ Cerla"), a trailing descriptor ("Three
  // Drives On A Vinyl" vs "Three Drives") or a "presents" credit ("Ricardo F. present
  // Chasis" vs "Ricardo F"). Match when one artist's words wholly contain the other's,
  // either way — still whole-word, so "Mat" never matches "Matador".
  it('matches when the candidate artist carries extra words around the library name', () => {
    const idx = buildLibraryIndex([
      { title: 'Rotterdam', artist: 'DJ Cerla' },
      { title: 'Greece', artist: 'Three Drives' },
      { title: 'Destroy', artist: 'Ricardo F' },
    ])
    expect(isInLibrary(idx, { title: 'Rotterdam', artist: 'Dr. DJ Cerla' })).toBe(true)
    expect(isInLibrary(idx, { title: 'Greece', artist: 'Three Drives On A Vinyl' })).toBe(true)
    expect(isInLibrary(idx, { title: 'Destroy', artist: 'Ricardo F. present Chasis' })).toBe(true)
  })

  // A "presents" credit joining two real acts ("Head Horny's presents Miguel Serna") names
  // the same collaboration the library files with an "&" ("Head Horny's & Miguel Serna").
  // The lone "presents" word sits between the two names, so neither side is a whole-word
  // subset of the other; treat "presents"/"pres." as a collaborator separator and keep the
  // lead, so the lead artist matches.
  it('matches a "presents" collaboration against the library "&" spelling', () => {
    const idx = buildLibraryIndex([
      { title: 'Keep It Together', artist: "Head Horny's & Miguel Serna", durationSec: 375 },
    ])
    expect(
      isInLibrary(idx, {
        title: 'Keep It Together',
        artist: "Head Horny's presents Miguel Serna",
        durationSec: 377,
      }),
    ).toBe(true)
  })

  // A Discogs disambiguator on the tag ("Aphex Twin (2)") must still match the plain
  // library name.
  it('strips a Discogs (n) disambiguator from the candidate artist', () => {
    const idx = buildLibraryIndex([{ title: 'Xtal', artist: 'Aphex Twin' }])
    expect(isInLibrary(idx, { title: 'Xtal', artist: 'Aphex Twin (2)' })).toBe(true)
  })

  // Some rips tag the title field as "Artist – Title" ("Debby – Maybe (Fields Of Love)"),
  // so the bare title never matches the library copy. With the artist known, strip a leading
  // copy of it off the title before keying.
  it('matches when the title field carries the artist as a prefix', () => {
    const idx = buildLibraryIndex([{ title: 'Maybe (Fields Of Love) (Club Vox)', artist: 'Debby' }])
    expect(isInLibrary(idx, { title: 'Debby - Maybe (Fields Of Love)', artist: 'Debby' })).toBe(
      true,
    )
  })

  // The reported case: a rip tagged with just the base title still matches the library
  // copy that keeps the release's version suffix — otherwise the badge says "in library"
  // (it found the canonical Discogs name) while the filter says it's missing.
  it('matches a base-title tag against a versioned library title', () => {
    const idx = buildLibraryIndex([{ title: 'It’s Not Over (Happy House)', artist: '3 Styles' }])
    expect(isInLibrary(idx, { title: 'It’s Not Over', artist: '3 Styles' })).toBe(true)
  })

  // And the other direction: a versioned tag matches a library copy stored under the base.
  it('matches a versioned tag against a base-title library entry', () => {
    const idx = buildLibraryIndex([{ title: 'It’s Not Over', artist: '3 Styles' }])
    expect(isInLibrary(idx, { title: 'It’s Not Over (Hard House)', artist: '3 Styles' })).toBe(true)
  })

  // Real case: a rip stacks two reissue markers ("Party Forever! (Original) (Remastered)")
  // while the library files the bare song. Stripping only the last group leaves "(Original)"
  // glued on and misses it, so all trailing version groups peel off down to the base title.
  it('matches a base title against a tag with two trailing version groups', () => {
    const idx = buildLibraryIndex([{ title: 'Party Forever', artist: 'Solar System' }])
    expect(
      isInLibrary(idx, {
        title: 'Party Forever! (Original) (Remastered)',
        artist: 'Solar System',
      }),
    ).toBe(true)
  })

  // The version-suffix tolerance must not blow the title gate open: a different song by
  // the same artist still reads as not-in-library.
  it('still misses a different base title by the same artist', () => {
    const idx = buildLibraryIndex([{ title: 'It’s Not Over (Happy House)', artist: '3 Styles' }])
    expect(isInLibrary(idx, { title: 'Da’ Bitch', artist: '3 Styles' })).toBe(false)
  })

  // The artist gate still applies across the base-title match.
  it('does not match a base title when the artist differs', () => {
    const idx = buildLibraryIndex([{ title: 'It’s Not Over (Happy House)', artist: '3 Styles' }])
    expect(isInLibrary(idx, { title: 'It’s Not Over', artist: 'Someone Else' })).toBe(false)
  })
})

describe('isInLibrary — version-aware scoring with duration', () => {
  // The reported case: the file is "Funky Feelings (Klubb Mix)" (6:07) but the library
  // holds a DIFFERENT version, "Funky Feelings (Klubb'ed Mix)" (8:06). Same base title and
  // artist, but distinct version suffixes AND far-apart durations — it's a different cut,
  // so the user must NOT be told they already own it. The version decides, not the base.
  it('does not match two different versions of one title when both name a distinct version', () => {
    const idx = buildLibraryIndex([
      { title: "Funky Feelings (Klubb'ed Mix)", artist: "Head Horny's", durationSec: 486 },
    ])
    expect(
      isInLibrary(idx, {
        title: 'Funky Feelings (Klubb Mix)',
        artist: 'Head Horny´s, Carlos Perez, K-Style',
        durationSec: 367,
      }),
    ).toBe(false)
  })

  // The same exact version (identical suffix) is owned even when the probed length differs
  // by a few seconds — a gap, fade or encoder rounding shifts the duration without it being
  // a different cut. Identical full title wins; duration only ever separates differing ones.
  it('matches the same version when only the duration drifts by a few seconds', () => {
    const idx = buildLibraryIndex([
      { title: 'Funky Feelings (Klubb Mix)', artist: "Head Horny's", durationSec: 367 },
    ])
    expect(
      isInLibrary(idx, {
        title: 'Funky Feelings (Klubb Mix)',
        artist: 'Head Horny´s, Carlos Perez, K-Style',
        durationSec: 372,
      }),
    ).toBe(true)
  })

  // The library title is just "Funky Feelings" while the file's title field carries the whole
  // release path "… - 04 Funky Feelings (Klubb Mix)". The library title is a trailing
  // word-run of the candidate, with the artist matching, so it's still found.
  it('matches when the library title is the tail of a full-filename title field', () => {
    const idx = buildLibraryIndex([{ title: 'Funky Feelings', artist: "Head Horny's" }])
    expect(
      isInLibrary(idx, {
        title: 'Funky Feelings 2026 - Alegria & Fuego - 04 Funky Feelings (Klubb Mix)',
        artist: 'Head Horny´s, Carlos Perez, K-Style',
      }),
    ).toBe(true)
  })

  // Duration is only a separator, never a gate: when one side has no duration (a library row
  // Music reported none for, or a Discogs-suggested candidate that carries none), an exact
  // title+artist still matches — the duration weight simply drops out.
  it('matches on title and artist alone when a duration is missing on either side', () => {
    const idx = buildLibraryIndex([{ title: 'Strobe', artist: 'deadmau5' }])
    expect(isInLibrary(idx, { title: 'Strobe', artist: 'deadmau5', durationSec: 634 })).toBe(true)
    const withDur = buildLibraryIndex([{ title: 'Strobe', artist: 'deadmau5', durationSec: 634 }])
    expect(isInLibrary(withDur, { title: 'Strobe', artist: 'deadmau5' })).toBe(true)
  })

  // Even with durations present and far apart, an identical full title (same version) stays
  // owned — encodes the rule that title identity outranks duration, which only separates
  // genuinely different version suffixes.
  it('keeps an identical-version match owned despite a large duration gap', () => {
    const idx = buildLibraryIndex([
      { title: 'Strobe (Club Mix)', artist: 'deadmau5', durationSec: 600 },
    ])
    expect(
      isInLibrary(idx, { title: 'Strobe (Club Mix)', artist: 'deadmau5', durationSec: 300 }),
    ).toBe(true)
  })
})
