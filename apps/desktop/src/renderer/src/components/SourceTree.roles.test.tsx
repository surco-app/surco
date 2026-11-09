// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlaylistRole } from '../../../shared/sessionTypes'
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
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]

function setup(values: Record<string, PlaylistRole> | null) {
  const onChange = vi.fn()
  render(
    <SourceTree
      width={236}
      title="rekordbox"
      source="rekordbox"
      nodes={NODES}
      failed={false}
      selectedId={null}
      onSelect={vi.fn()}
      edit={{
        onCreate: vi.fn(),
        onDropTracks: vi.fn(),
        onRename: vi.fn(),
        onDelete: vi.fn(),
        onPasteTracklist: vi.fn(),
      }}
      roles={values ? { values, onChange } : undefined}
    />,
  )
  return onChange
}

const openMenu = (id: string) =>
  fireEvent.contextMenu(screen.getByTestId(`source-node-${id}`), { clientX: 10, clientY: 10 })

describe('SourceTree playlist roles', () => {
  it('shows the letter of the role next to a playlist that has one', () => {
    setup({ house: 'base' })
    const letter = screen.getByTestId('source-tree-role-house')
    expect(letter).toHaveTextContent(i18n.t('sessions.roleLetter.base'))
    expect(letter).toHaveAccessibleName(i18n.t('sessions.role.base'))
  })

  it('shows nothing next to a playlist without a role', () => {
    setup({})
    expect(screen.queryByTestId('source-tree-role-house')).toBeNull()
  })

  it('never shows a letter on a folder, even if the value has its id', () => {
    setup({ bases: 'base' })
    expect(screen.queryByTestId('source-tree-role-bases')).toBeNull()
  })

  it('offers the roles in the menu of a playlist, with the current one pressed', () => {
    setup({ house: 'vocal' })
    openMenu('house')
    expect(screen.getByTestId('source-tree-role-pick-vocal')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('hands the node and the chosen role over and closes the menu', () => {
    const onChange = setup({})
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-role-pick-set'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 'house' }),
      'set',
    )
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  })

  it('takes the role away when the active one is pressed again', () => {
    const onChange = setup({ house: 'base' })
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-role-pick-base'))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'house' }), null)
  })

  it('does not offer roles in the menu of a folder', () => {
    setup({})
    openMenu('bases')
    expect(screen.queryByTestId('source-tree-role-pick-base')).toBeNull()
  })

  it('offers nothing about roles when the tree has no roles to give', () => {
    setup(null)
    openMenu('house')
    expect(screen.queryByTestId('source-tree-role-pick-base')).toBeNull()
    expect(screen.queryByTestId('source-tree-role-house')).toBeNull()
  })
})
