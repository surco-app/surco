import { describe, expect, it } from 'vitest'
import { musicEntries, musicTree } from './appleMusicSource'

describe('musicTree', () => {
  it('puts root playlists first and groups the rest under their folder, the only thing telling repeated names apart', () => {
    const tree = musicTree([
      { name: '95', count: 10, persistentId: 'AAAAAAAAAAAAAAA1', folder: 'Bases' },
      { name: 'House', count: 32, persistentId: 'AAAAAAAAAAAAAAA2' },
      { name: '95', count: 4, persistentId: 'AAAAAAAAAAAAAAA3', folder: 'Cantaditas' },
    ])
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
