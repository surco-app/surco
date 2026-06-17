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

  // A Discogs disambiguator on the tag ("Aphex Twin (2)") must still match the plain
  // library name.
  it('strips a Discogs (n) disambiguator from the candidate artist', () => {
    const idx = buildLibraryIndex([{ title: 'Xtal', artist: 'Aphex Twin' }])
    expect(isInLibrary(idx, { title: 'Xtal', artist: 'Aphex Twin (2)' })).toBe(true)
  })
})
