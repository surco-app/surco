import { describe, expect, it } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import { suggestRoles, withoutSeparators } from './sessionTree'

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

describe('suggestRoles', () => {
  const folder = (id: string, name: string, children: SourceNode[]): SourceNode => ({
    id,
    name,
    kind: 'folder',
    count: children.length,
    children,
  })

  it('gives every playlist of a folder called Bases the role base', () => {
    const tree = [folder('f', 'BASES', [playlist('a', 'Todas'), playlist('b', 'Fijas')])]
    expect(suggestRoles(tree)).toEqual({ a: 'base', b: 'base' })
  })

  it('reads Cantaditas and Vocals as vocal, ignoring case and accents', () => {
    const tree = [
      folder('f', 'CANTADITAS', [playlist('a', 'Todas')]),
      folder('g', 'Vocals', [playlist('b', 'Fijas')]),
      folder('h', 'Acapellas', [playlist('c', 'Viejas')]),
    ]
    expect(suggestRoles(tree)).toEqual({ a: 'vocal', b: 'vocal', c: 'vocal' })
  })

  it('reads folders of tracklists, combos and sets as mixed, since their order is the point', () => {
    const tree = [
      folder('f', 'COMBOS', [playlist('a', '90s')]),
      folder('g', 'BOLOS', [playlist('b', 'Bolo 1')]),
      folder('h', 'TRACKLIST', [playlist('c', 'Set')]),
    ]
    expect(suggestRoles(tree)).toEqual({ a: 'any', b: 'any', c: 'any' })
  })

  it('reaches playlists nested in sub-folders and folders that are not at the top', () => {
    const tree = [
      folder('top', 'Music', [folder('f', 'Bases', [folder('g', '90s', [playlist('a', 'x')])])]),
    ]
    expect(suggestRoles(tree)).toEqual({ a: 'base' })
  })

  it('leaves every other folder and every loose playlist without a suggestion', () => {
    const tree = [folder('f', 'Remember', [playlist('a', 'x')]), playlist('b', 'Bases')]
    expect(suggestRoles(tree)).toEqual({})
  })

  it('lets the outer folder decide when two nested folders disagree', () => {
    const tree = [folder('f', 'Bases', [folder('g', 'Cantaditas', [playlist('a', 'x')])])]
    expect(suggestRoles(tree)).toEqual({ a: 'base' })
  })
})
