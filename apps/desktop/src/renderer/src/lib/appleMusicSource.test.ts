import { describe, expect, it } from 'vitest'
import { joinStretches, musicEntries, musicTree } from './appleMusicSource'

describe('musicTree', () => {
  it('puts root playlists first and groups the rest under their folder, the only thing telling repeated names apart', () => {
    const tree = musicTree(
      [
        { name: '95', count: 10, persistentId: 'AAAAAAAAAAAAAAA1', folder: 'Bases' },
        { name: 'House', count: 32, persistentId: 'AAAAAAAAAAAAAAA2' },
        { name: '95', count: 4, persistentId: 'AAAAAAAAAAAAAAA3', folder: 'Cantaditas' },
      ],
      'All tracks',
    )
    expect(tree.map((n) => [n.kind, n.name])).toEqual([
      ['playlist', 'House'],
      ['folder', 'Bases'],
      ['folder', 'Cantaditas'],
    ])
    expect(tree[1].children?.[0]).toEqual({
      id: 'AAAAAAAAAAAAAAA1',
      name: '95',
      kind: 'playlist',
      count: 10,
    })
  })

  // rekordbox, Engine DJ and Traktor all open on All tracks; Music's playlist of every song
  // is the same thing under the name the system language gives it.
  it('puts the playlist of every song first as All tracks', () => {
    const tree = musicTree(
      [
        { name: 'House', count: 32, persistentId: 'AAAAAAAAAAAAAAA2' },
        { name: 'Música', count: 2044, persistentId: 'AAAAAAAAAAAAAAA1', library: true },
      ],
      'All tracks',
    )
    expect(tree.map((n) => [n.id, n.name])).toEqual([
      ['AAAAAAAAAAAAAAA1', 'All tracks'],
      ['AAAAAAAAAAAAAAA2', 'House'],
    ])
  })
})

describe('musicEntries', () => {
  it('carries the Music identity with each file, so converting updates that library copy', () => {
    const rows = musicEntries({
      paths: ['/m/a.wav'],
      persistentIds: { '/m/a.wav': 'PID0000000000001' },
      meta: { '/m/a.wav': { grouping: 'Bases' } },
      missing: 2,
    })
    expect(rows[0]).toEqual({
      path: '/m/a.wav',
      separator: false,
      meta: { grouping: 'Bases' },
      musicPersistentId: 'PID0000000000001',
    })
  })

  it('keeps the file-less rows as entries, so the count still says how many Music holds', () => {
    const rows = musicEntries({ paths: [], persistentIds: {}, meta: {}, missing: 2 })
    expect(rows).toEqual([
      { path: null, separator: false, meta: {} },
      { path: null, separator: false, meta: {} },
    ])
  })
})

describe('joinStretches', () => {
  // Two Music entries can point at one file, and the read is now cut in stretches: the second
  // entry may fall in a later one. The row keeps the first entry's identity, as a single read
  // did, or a later conversion would update the wrong library copy.
  it('keeps a file listed in two stretches once, with the first entry it came from', () => {
    const joined = joinStretches(
      {
        paths: ['/m/a.wav'],
        persistentIds: { '/m/a.wav': 'FIRST' },
        meta: { '/m/a.wav': { year: '1993' } },
        missing: 1,
        total: 4,
      },
      {
        paths: ['/m/b.wav', '/m/a.wav'],
        persistentIds: { '/m/a.wav': 'SECOND', '/m/b.wav': 'B' },
        meta: { '/m/a.wav': { year: '2001' } },
        missing: 0,
        total: 4,
      },
    )
    expect(joined.paths).toEqual(['/m/a.wav', '/m/b.wav'])
    expect(joined.persistentIds).toEqual({ '/m/a.wav': 'FIRST', '/m/b.wav': 'B' })
    expect(joined.meta['/m/a.wav']).toEqual({ year: '1993' })
  })

  it('adds up the tracks without a file across stretches, so the notice counts all of them', () => {
    const empty = { paths: [], persistentIds: {}, meta: {} }
    expect(joinStretches({ ...empty, missing: 2 }, { ...empty, missing: 3 }).missing).toBe(5)
  })
})
