import { describe, expect, it } from 'vitest'
import type { MusicReviewEntry } from '../../../shared/types'
import { replaceAct, spellingGroups, splitActs } from './musicSpelling'

let n = 0
function entry(over: Partial<MusicReviewEntry>): MusicReviewEntry {
  n += 1
  return {
    persistentId: n.toString(16).toUpperCase().padStart(16, '0'),
    title: `T${n}`,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    ...over,
  }
}
const many = (count: number, over: Partial<MusicReviewEntry>) =>
  Array.from({ length: count }, () => entry(over))
const byField = (groups: ReturnType<typeof spellingGroups>, field: string) =>
  groups.filter((g) => g.field === field)

describe('splitActs / replaceAct', () => {
  it('splits a collaboration into its acts', () => {
    expect(splitActs('DJ Lara, DJ Sergi Val')).toEqual(['DJ Lara', 'DJ Sergi Val'])
    expect(splitActs('OceanLab x Ferry Corsten')).toEqual(['OceanLab', 'Ferry Corsten'])
    expect(splitActs('Alex C. Feat. Yasmin K.')).toEqual(['Alex C.', 'Yasmin K.'])
  })

  it('renames one act and leaves the rest of the credit as it was written', () => {
    expect(replaceAct('Dj Lara, DJ Sergi Val', 'Dj Lara', 'DJ Lara')).toBe('DJ Lara, DJ Sergi Val')
    expect(replaceAct('Dj Laraa & Dj Lara', 'Dj Lara', 'DJ Lara')).toBe('Dj Laraa & DJ Lara')
  })
})

describe('spellingGroups', () => {
  it('groups the same act written with other capitals and suggests the common spelling', () => {
    const groups = spellingGroups([
      ...many(11, { artist: 'DJ Lara' }),
      entry({ artist: 'Dj Lara' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('case')
    expect(g.suggested).toBe('DJ Lara')
    expect(g.variants.map((v) => [v.value, v.persistentIds.length])).toEqual([
      ['DJ Lara', 11],
      ['Dj Lara', 1],
    ])
  })

  it('finds an act inside a collaboration', () => {
    const groups = spellingGroups([
      ...many(3, { artist: 'DJ Lara' }),
      entry({ artist: 'Dj Lara, DJ Sergi Val' }),
    ])
    expect(byField(groups, 'artist')[0].variants.map((v) => v.value)).toEqual([
      'DJ Lara',
      'Dj Lara',
    ])
  })

  // Measured on the real library: "Christian Millán" twice, one composed and one not.
  it('treats a composed and a decomposed accent as two spellings of one name', () => {
    const groups = spellingGroups([
      entry({ albumArtist: 'Christian Millán' }),
      entry({ albumArtist: 'Christian Millán' }),
    ])
    expect(byField(groups, 'albumArtist')[0].kind).toBe('case')
  })

  it('calls an apostrophe or a space a punctuation difference', () => {
    const groups = spellingGroups([
      ...many(44, { artist: "Head Horny's" }),
      ...many(5, { artist: 'Head Horny´s' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('punctuation')
    expect(g.suggested).toBe("Head Horny's")
  })

  it('flags invisible characters even when nothing else is spelled differently', () => {
    const groups = spellingGroups([entry({ artist: 'Aar​ó​n Alfonso' })])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('invisible')
    expect(g.suggested).toBe('Aarón Alfonso')
  })

  it('checks titles for invisible characters only', () => {
    const groups = spellingGroups([
      entry({ title: 'El Trayon 2​.​0' }),
      entry({ title: 'Bleeding Love' }),
      entry({ title: 'bleeding love' }),
    ])
    const titles = byField(groups, 'title')
    expect(titles).toHaveLength(1)
    expect(titles[0].suggested).toBe('El Trayon 2.0')
  })

  it('suggests a likely typo but never marks it safe and names no winner on a tie', () => {
    const groups = spellingGroups([
      ...many(2, { artist: 'Rachel Auburn' }),
      ...many(2, { artist: 'Rahcel Auburn' }),
    ])
    const [g] = byField(groups, 'artist')
    expect(g.kind).toBe('typo')
    expect(g.suggested).toBeNull()
  })

  it('does not call two names a typo when their numbers differ', () => {
    expect(
      spellingGroups([entry({ album: 'Hits Vol 1' }), entry({ album: 'Hits Vol 2' })]),
    ).toEqual([])
  })

  it('keeps albums of different artists apart', () => {
    const groups = spellingGroups([
      entry({ album: 'Need You', albumArtist: 'A' }),
      entry({ album: 'NEED YOU', albumArtist: 'B' }),
    ])
    expect(byField(groups, 'album')).toEqual([])
  })

  it('leaves a genre with several values alone', () => {
    const groups = spellingGroups([
      entry({ genre: 'Electronic, Latin, Pop' }),
      entry({ genre: 'electronic, latin, pop' }),
    ])
    expect(byField(groups, 'genre')).toEqual([])
  })

  it('gives the same group the same key on every read, so an ignore sticks', () => {
    const make = () =>
      spellingGroups([...many(2, { genre: 'Electronic' }), entry({ genre: 'electronic' })])
    expect(make()[0].key).toBe(make()[0].key)
  })

  it('reports nothing for a clean library', () => {
    expect(spellingGroups([...many(3, { artist: 'DJ Lara', album: 'X', genre: 'House' })])).toEqual(
      [],
    )
  })
})
