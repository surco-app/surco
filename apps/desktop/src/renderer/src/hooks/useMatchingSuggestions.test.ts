import { describe, expect, it } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import { mixedPlaylistIds, pathSequences } from './useMatchingSuggestions'

const playlist = (id: string, name = id): SourceNode => ({ id, name, kind: 'playlist', count: 1 })
const folder = (name: string, children: SourceNode[]): SourceNode => ({
  id: `f-${name}`,
  name,
  kind: 'folder',
  count: 0,
  children,
})

describe('mixedPlaylistIds', () => {
  it('takes the playlists under a folder of sets, combos or tracklists, as the automatic session does', () => {
    const tree = [
      folder('COMBOS', [playlist('90s'), playlist('20Ks')]),
      folder('BASES', [playlist('b1')]),
      folder('TRACKLIST', [playlist('t1')]),
      playlist('House'),
    ]
    expect(mixedPlaylistIds(tree, new Set())).toEqual(['20Ks', '90s', 't1'])
  })

  it('leaves out the sessions Surco wrote, so a session never proves its own pairs', () => {
    const tree = [folder('COMBOS', [playlist('90s'), playlist('made')])]
    expect(mixedPlaylistIds(tree, new Set(['made']))).toEqual(['90s'])
  })
})

describe('pathSequences', () => {
  const row = (path: string | null, separator = false) => ({ path, separator, meta: {} })

  it('reads each playlist as a run of files, cut where a separator or a missing file sits', () => {
    expect(
      pathSequences([
        [
          row('/m/a.wav'),
          row('/m/b.wav'),
          row('/m/_.mp3', true),
          row('/m/c.wav'),
          row(null),
          row('/m/d.wav'),
        ],
        [row('/m/Canción.wav'.normalize('NFD')), row('/m/e.wav')],
      ]),
    ).toEqual([
      ['/m/a.wav', '/m/b.wav'],
      ['/m/c.wav'],
      ['/m/d.wav'],
      ['/m/Canción.wav'.normalize('NFC'), '/m/e.wav'],
    ])
  })
})
