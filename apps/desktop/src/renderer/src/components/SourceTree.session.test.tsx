// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import { SourceTree } from './SourceTree'

afterEach(cleanup)

const NODES: SourceNode[] = [
  {
    id: 'bases',
    name: 'BASES',
    kind: 'folder',
    count: 1,
    children: [{ id: 'bt', name: 'Todas', kind: 'playlist', count: 336 }],
  },
  { id: 'prep', name: 'Preparation', kind: 'folder', count: 0, children: [] },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
  { id: 'emptied', name: 'Session 11-9', kind: 'playlist', count: 0 },
]

function setup({
  withSession = true,
  withFill = true,
  crates = false,
  fixed,
}: {
  withSession?: boolean
  withFill?: boolean
  crates?: boolean
  fixed?: (node: SourceNode) => 'locked' | 'tracks-only' | null
} = {}) {
  const onSession = vi.fn()
  const onFill = vi.fn()
  render(
    <SourceTree
      width={236}
      title="rekordbox"
      source="rekordbox"
      nodes={NODES}
      failed={false}
      selectedId={null}
      onSelect={vi.fn()}
      fixed={fixed}
      edit={{
        onCreate: vi.fn(),
        onDropTracks: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onPasteTracklist: vi.fn(),
        ...(withSession ? { onSession } : {}),
        ...(withFill ? { onFill } : {}),
        ...(crates ? { crates: true as const } : {}),
      }}
    />,
  )
  return Object.assign(onSession, { onFill })
}

const openMenu = (id: string) =>
  fireEvent.contextMenu(screen.getByTestId(`source-node-${id}`), { clientX: 10, clientY: 10 })

describe('SourceTree automatic session item', () => {
  it('offers the item on a folder, handing the folder over and closing the menu', () => {
    const onSession = setup()
    openMenu('bases')
    const item = screen.getByTestId('source-tree-session')
    expect(item).toHaveTextContent(i18n.t('sources.tree.newSession'))
    fireEvent.click(item)
    expect(onSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'bases' }))
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  })

  it('files it with the creating items, before Rename and Delete', () => {
    setup()
    openMenu('bases')
    const items = within(screen.getByTestId('source-tree-menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
      'source-tree-new-playlist-inside',
      'source-tree-new-folder-inside',
      'source-tree-paste-tracklist',
      'source-tree-session',
      'source-tree-rename',
      'source-tree-delete',
    ])
  })

  it('does not offer it on a playlist, which cannot hold another', () => {
    setup()
    openMenu('house')
    expect(screen.queryByTestId('source-tree-session')).toBeNull()
  })

  it('offers it on any crate where crates can hold crates', () => {
    setup({ crates: true })
    openMenu('house')
    expect(screen.getByTestId('source-tree-session')).toBeInTheDocument()
  })

  it('does not offer it in a folder the library keeps for itself', () => {
    setup({ fixed: (node) => (node.id === 'prep' ? 'tracks-only' : null) })
    openMenu('prep')
    expect(screen.queryByTestId('source-tree-session')).toBeNull()
  })

  it('offers nothing when the tree has no session to open', () => {
    setup({ withSession: false })
    openMenu('bases')
    expect(screen.queryByTestId('source-tree-session')).toBeNull()
  })
})

describe('SourceTree fill with a session item', () => {
  it('offers to fill a playlist that has no track, handing it over and closing the menu', () => {
    const { onFill } = setup()
    openMenu('emptied')
    const item = screen.getByTestId('source-tree-fill-session')
    expect(item).toHaveTextContent(i18n.t('sources.tree.fillSession'))
    fireEvent.click(item)
    expect(onFill).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'emptied' }))
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  })

  it('does not offer it on a playlist that already has tracks, which it would add to', () => {
    setup()
    openMenu('house')
    expect(screen.queryByTestId('source-tree-fill-session')).toBeNull()
  })

  it('does not offer it on a folder, which has its own new session item', () => {
    setup()
    openMenu('bases')
    expect(screen.queryByTestId('source-tree-fill-session')).toBeNull()
  })

  it('offers nothing when the tree cannot fill a playlist', () => {
    setup({ withFill: false })
    openMenu('emptied')
    expect(screen.queryByTestId('source-tree-fill-session')).toBeNull()
  })

  it('does not offer it in a playlist the library keeps for itself', () => {
    setup({ fixed: (node) => (node.id === 'emptied' ? 'tracks-only' : null) })
    openMenu('emptied')
    expect(screen.queryByTestId('source-tree-fill-session')).toBeNull()
  })

  it('files it right after Paste tracklist, before Rename and Delete', () => {
    setup()
    openMenu('emptied')
    const items = within(screen.getByTestId('source-tree-menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
      'source-tree-paste-tracklist',
      'source-tree-fill-session',
      'source-tree-rename',
      'source-tree-delete',
    ])
  })
})

describe('SourceTree playlist menu without role tags', () => {
  it('leaves the role to the wizard, so the menu of a playlist holds no tags', () => {
    setup()
    openMenu('house')
    const menu = screen.getByTestId('source-tree-menu')
    expect(within(menu).queryByRole('group')).toBeNull()
    expect(menu.querySelector('[data-testid^="source-tree-role"]')).toBeNull()
  })
})
