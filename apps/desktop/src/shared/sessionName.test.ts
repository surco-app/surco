import { describe, expect, it } from 'vitest'
import type { SourceNode } from './types'
import { childNames, nodeNameOf, parentIdOf, sessionDateLabel, uniqueName } from './sessionName'

const TREE: SourceNode[] = [
  {
    id: 'sets',
    name: 'Sets',
    kind: 'folder',
    count: 0,
    children: [
      { id: 'a', name: 'Sesión', kind: 'playlist', count: 3 },
      { id: 'inner', name: 'Inner', kind: 'folder', count: 0, children: [] },
    ],
  },
  { id: 'top', name: 'Top', kind: 'playlist', count: 1 },
]

describe('sessionDateLabel', () => {
  const day = new Date(2026, 10, 9)

  it('never holds a slash, which a Serato crate name refuses', () => {
    for (const locale of ['es', 'en', 'fr', 'de', 'ja', 'pt-BR', 'ca', undefined]) {
      expect(sessionDateLabel(day, locale)).not.toContain('/')
    }
  })

  it('keeps the day and the month', () => {
    const label = sessionDateLabel(day, 'es')
    expect(label).toContain('9')
    expect(label).toContain('11')
  })
})

describe('uniqueName', () => {
  it('keeps the name when no sibling has it', () => {
    expect(uniqueName('Sesión 9-11', new Set(['Otra']))).toBe('Sesión 9-11')
  })

  it('adds a number when a sibling has it, taking the first free one', () => {
    expect(uniqueName('Sesión 9-11', new Set(['Sesión 9-11']))).toBe('Sesión 9-11 (2)')
    expect(uniqueName('Sesión 9-11', new Set(['Sesión 9-11', 'Sesión 9-11 (2)']))).toBe(
      'Sesión 9-11 (3)',
    )
  })

  it('goes back to the plain name once the numbered one is the only one left', () => {
    expect(uniqueName('Sesión 9-11', new Set(['Sesión 9-11 (2)']))).toBe('Sesión 9-11')
  })
})

describe('childNames', () => {
  it('lists the names at the top of the tree for the root', () => {
    expect(childNames(TREE, 'root')).toEqual(new Set(['Sets', 'Top']))
  })

  it('lists the names inside a folder, found at any depth', () => {
    expect(childNames(TREE, 'sets')).toEqual(new Set(['Sesión', 'Inner']))
    expect(childNames(TREE, 'inner')).toEqual(new Set())
  })

  it('is empty for a folder that is not in the tree, or for no tree', () => {
    expect(childNames(TREE, 'gone')).toEqual(new Set())
    expect(childNames(undefined, 'root')).toEqual(new Set())
  })
})

describe('parentIdOf', () => {
  it('names the folder a playlist sits in', () => {
    expect(parentIdOf(TREE, 'a')).toBe('sets')
  })

  it('names a folder inside a folder by the outer one', () => {
    expect(parentIdOf(TREE, 'inner')).toBe('sets')
  })

  it('answers root for what sits at the top of the tree', () => {
    expect(parentIdOf(TREE, 'top')).toBe('root')
    expect(parentIdOf(TREE, 'sets')).toBe('root')
  })

  it('answers nothing for an id that is not in the tree', () => {
    expect(parentIdOf(TREE, 'gone')).toBeNull()
    expect(parentIdOf(undefined, 'a')).toBeNull()
  })
})

describe('nodeNameOf', () => {
  it('names a folder or a playlist anywhere in the tree', () => {
    expect(nodeNameOf(TREE, 'sets')).toBe('Sets')
    expect(nodeNameOf(TREE, 'a')).toBe('Sesión')
    expect(nodeNameOf(TREE, 'inner')).toBe('Inner')
  })

  it('answers nothing for the top of the tree, an id that is not there or no tree', () => {
    expect(nodeNameOf(TREE, 'root')).toBeNull()
    expect(nodeNameOf(TREE, 'gone')).toBeNull()
    expect(nodeNameOf(undefined, 'a')).toBeNull()
  })
})
