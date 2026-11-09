import { describe, expect, it } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import { withoutSeparators } from './sessionTree'

const playlist = (id: string, name: string, count = 3): SourceNode => ({
  id,
  name,
  kind: 'playlist',
  count,
})

describe('withoutSeparators', () => {
  it('drops a playlist that is only a line of dashes, underscores, equals signs or stars', () => {
    const tree = [
      playlist('a', 'Mashups'),
      playlist('d', '--------------------'),
      playlist('u', '____'),
      playlist('e', '====='),
      playlist('s', '***'),
    ]
    expect(withoutSeparators(tree).map((node) => node.id)).toEqual(['a'])
  })

  it('keeps a playlist whose name only has a dash in it', () => {
    const tree = [playlist('a', '111224 - XTV Vol 1'), playlist('b', 'A-B')]
    expect(withoutSeparators(tree)).toHaveLength(2)
  })

  it('drops the separators inside folders and keeps the folders', () => {
    const tree: SourceNode[] = [
      {
        id: 'f',
        name: 'BOLOS',
        kind: 'folder',
        count: 2,
        children: [playlist('x', 'Bolo 1'), playlist('y', '-----')],
      },
    ]
    const [folder] = withoutSeparators(tree)
    expect(folder.children?.map((node) => node.id)).toEqual(['x'])
  })

  it('keeps an empty folder, since that is the user own choice', () => {
    const tree: SourceNode[] = [{ id: 'f', name: 'Prep', kind: 'folder', count: 0, children: [] }]
    expect(withoutSeparators(tree)).toHaveLength(1)
  })

  it('does not touch a name with nothing in it, which is an unnamed playlist and not a separator', () => {
    expect(withoutSeparators([playlist('n', '')])).toHaveLength(1)
  })
})
