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
    const idx = buildLibraryIndex([
      { title: 'Maybe (Fields Of Love) (Club Vox)', artist: 'Debby' },
    ])
    expect(isInLibrary(idx, { title: 'Debby - Maybe (Fields Of Love)', artist: 'Debby' })).toBe(true)
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
