import { describe, expect, it } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import { mixedPlaylistIds } from './useMatchingSuggestions'

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
