import { describe, expect, it } from 'vitest'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { matchingEntriesFor, pathPartners, unionPathPairs } from './matchingPaths'

const entry = (path: string, title: string, key = ''): SourcePlaylistEntry => ({
  path,
  separator: false,
  meta: key ? { key } : {},
  contentId: `traktor:${path}`,
  preview: { title, artist: 'DJ', durationSec: 200, cues: [] },
})

describe('unionPathPairs', () => {
  it('joins the pairs Surco keeps with the ones marked in rekordbox, by file', () => {
    const pathOf = new Map([
      ['1', '/m/a.wav'],
      ['2', '/m/b.wav'],
    ])
    expect(unionPathPairs([['/m/c.wav', '/m/d.wav']], [['1', '2']], pathOf)).toEqual([
      ['/m/c.wav', '/m/d.wav'],
      ['/m/a.wav', '/m/b.wav'],
    ])
  })

  it('lists a pair once when Surco and rekordbox both hold it', () => {
    const pathOf = new Map([
      ['1', '/m/a.wav'],
      ['2', '/m/b.wav'],
    ])
    expect(unionPathPairs([['/m/b.wav', '/m/a.wav']], [['1', '2']], pathOf)).toHaveLength(1)
  })

  it('leaves out a rekordbox pair whose file it cannot find, like a streamed track', () => {
    expect(unionPathPairs([], [['1', '2']], new Map([['1', '/m/a.wav']]))).toEqual([])
  })
})

describe('matchingEntriesFor', () => {
  const ALL = [
    entry('/m/a.wav', 'Alpha'),
    entry('/m/b.wav', 'Bravo'),
    entry('/m/c.wav', 'Charlie'),
    entry('/m/d.wav', 'Delta'),
    entry('/m/e.wav', 'Echo'),
  ]

  it("lists the program's tracks that have a partner, chain by chain with a separator between", () => {
    const rows = matchingEntriesFor(ALL, [
      ['/m/d.wav', '/m/e.wav'],
      ['/m/a.wav', '/m/b.wav'],
      ['/m/b.wav', '/m/c.wav'],
    ])
    expect(rows.map((r) => (r.separator ? '|' : r.preview?.title))).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      '|',
      'Delta',
      'Echo',
    ])
  })

  it('leaves out a pair with a track the program does not have', () => {
    expect(matchingEntriesFor(ALL, [['/m/a.wav', '/other/z.wav']])).toEqual([])
  })
})

describe('pathPartners', () => {
  it("names the chosen file's partners with what the program shows for them", () => {
    const ALL = [entry('/m/a.wav', 'Alpha'), entry('/m/b.wav', 'Bravo', '8A')]
    expect(pathPartners([['/m/b.wav', '/m/a.wav']], '/m/a.wav', ALL)).toEqual([
      { contentId: '/m/b.wav', path: '/m/b.wav', title: 'Bravo', artist: 'DJ', key: '8A' },
    ])
  })
})
