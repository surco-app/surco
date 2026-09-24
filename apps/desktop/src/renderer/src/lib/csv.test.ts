import { describe, expect, it } from 'vitest'
import { csvHas, splitCsv, toggleCsv } from './csv'

describe('splitCsv', () => {
  it('trims and drops empty entries', () => {
    expect(splitCsv(' Bases ,, Cantaditas , ')).toEqual(['Bases', 'Cantaditas'])
  })
})

describe('csvHas', () => {
  it('matches a whole tag, not a substring', () => {
    expect(csvHas('Bases, Cantaditas', 'Bases')).toBe(true)
    expect(csvHas('Bases, Cantaditas', 'Base')).toBe(false)
  })

  // A provider writes "electronic" where the user's preset says "Electronic": they are the
  // same genre, so the preset chip has to read as on rather than offer a second copy.
  it('ignores case, so a provider genre lights the preset chip', () => {
    expect(csvHas('electronic, funk', 'Electronic')).toBe(true)
  })
})

describe('toggleCsv', () => {
  it('adds a tag when absent', () => {
    expect(toggleCsv('Bases', 'Cantaditas')).toBe('Bases, Cantaditas')
  })

  it('removes a tag when present', () => {
    expect(toggleCsv('Bases, Cantaditas', 'Bases')).toBe('Cantaditas')
  })

  it('removes a tag written in another case instead of adding a duplicate', () => {
    expect(toggleCsv('electronic, funk', 'Electronic')).toBe('funk')
  })

  it('adds to an empty value', () => {
    expect(toggleCsv('', 'Bases')).toBe('Bases')
  })
})

// A tag that holds commas ("Folk, World, & Country") stays one tag wherever it sits, and
// toggling a neighbour neither splits it nor moves it.
describe('tags that contain commas', () => {
  const whole = ['Folk, World, & Country']

  it('splits around the whole name, in the order the text has', () => {
    expect(splitCsv('Pop, Folk, World, & Country, Rock', whole)).toEqual([
      'Pop',
      'Folk, World, & Country',
      'Rock',
    ])
  })

  it('removes the whole name as one tag', () => {
    expect(toggleCsv('Pop, Folk, World, & Country', 'Folk, World, & Country', whole)).toBe('Pop')
  })
})

// Plex splits a genre tag on ";" and reads "Pop, Indie Pop" as one genre, so the user picks
// the separator each field is written with. Reading splits on that one only: splitting on
// every candidate would cut genres that carry a slash, like "Hip Hop/Rap".
describe('a chosen separator', () => {
  it('joins with it', () => {
    expect(toggleCsv('Pop', 'Indie Pop', [], '; ')).toBe('Pop; Indie Pop')
  })

  it('splits on it with or without the space', () => {
    expect(splitCsv('Pop;Indie Pop; Dance', [], '; ')).toEqual(['Pop', 'Indie Pop', 'Dance'])
  })

  it('keeps the other separators inside a tag', () => {
    expect(splitCsv('Hip Hop/Rap; Pop, Rock', [], '; ')).toEqual(['Hip Hop/Rap', 'Pop, Rock'])
  })

  it('keeps a whole name whole when it sits beside the chosen separator', () => {
    expect(splitCsv('Folk, World, & Country;Pop', ['Folk, World, & Country'], '; ')).toEqual([
      'Folk, World, & Country',
      'Pop',
    ])
  })

  it('finds and removes a tag by it', () => {
    expect(csvHas('Album;Remix', 'Remix', [], ';')).toBe(true)
    expect(toggleCsv('Album;Remix', 'Remix', [], ';')).toBe('Album')
  })
})
