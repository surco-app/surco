// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import { CheckTree, folderState, foldersHolding, playlistIdsUnder } from './CheckTree'

beforeAll(async () => {
  await i18n.changeLanguage('es')
})
afterEach(cleanup)

const NODES: SourceNode[] = [
  {
    id: 'bases',
    name: 'BASES',
    kind: 'folder',
    count: 2,
    children: [
      { id: 'mak', name: 'Makina', kind: 'playlist', count: 7 },
      {
        id: '90s',
        name: '90s',
        kind: 'folder',
        count: 1,
        children: [{ id: 'todas', name: 'Todas', kind: 'playlist', count: 336 }],
      },
    ],
  },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]

describe('folder helpers', () => {
  it('lists every playlist under a folder, nested ones included', () => {
    expect(playlistIdsUnder(NODES[0])).toEqual(['mak', 'todas'])
  })
  it('reads a folder as all, some or none', () => {
    expect(folderState(NODES[0], new Set(['mak', 'todas']))).toBe('all')
    expect(folderState(NODES[0], new Set(['mak']))).toBe('some')
    expect(folderState(NODES[0], new Set())).toBe('none')
  })
  it('names the folders that hold a ticked playlist, nested ones included', () => {
    expect(foldersHolding(NODES, new Set(['todas']))).toEqual(['bases', '90s'])
    expect(foldersHolding(NODES, new Set(['house']))).toEqual([])
  })
})

describe('CheckTree', () => {
  it('ticks a whole folder, and unticks it when all was ticked', () => {
    const onChange = vi.fn()
    const { rerender } = render(<CheckTree nodes={NODES} checked={new Set()} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('check-node-bases'))
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['mak', 'todas'])
    rerender(<CheckTree nodes={NODES} checked={new Set(['mak', 'todas'])} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('check-node-bases'))
    expect([...onChange.mock.calls[1][0]]).toEqual([])
  })

  it('shows a folder half ticked when only part of it is', () => {
    render(<CheckTree nodes={NODES} checked={new Set(['mak'])} onChange={() => {}} />)
    expect(screen.getByTestId('check-node-bases')).toHaveProperty('indeterminate', true)
    expect(screen.getByTestId('check-node-house')).not.toBeChecked()
  })

  it('ticks a single playlist with its track count beside it', () => {
    const onChange = vi.fn()
    render(<CheckTree nodes={NODES} checked={new Set()} onChange={onChange} />)
    expect(screen.getByTestId('check-row-house')).toHaveTextContent('32')
    fireEvent.click(screen.getByTestId('check-node-house'))
    expect([...onChange.mock.calls[0][0]]).toEqual(['house'])
  })

  // Every tick elsewhere used to reopen each folder holding a ticked playlist, so a folder
  // the user had just closed sprang open again. Only a newly ticked playlist opens its way.
  it('keeps a folder the user closed shut when another playlist is ticked', () => {
    const { rerender } = render(
      <CheckTree nodes={NODES} checked={new Set(['todas'])} onChange={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'BASES' }))
    expect(screen.queryByTestId('check-node-todas')).toBeNull()
    rerender(<CheckTree nodes={NODES} checked={new Set(['todas', 'house'])} onChange={() => {}} />)
    expect(screen.queryByTestId('check-node-todas')).toBeNull()
  })

  it('opens the way to a playlist ticked while its folder was closed', () => {
    const { rerender } = render(<CheckTree nodes={NODES} checked={new Set()} onChange={() => {}} />)
    expect(screen.queryByTestId('check-node-mak')).toBeNull()
    rerender(<CheckTree nodes={NODES} checked={new Set(['mak'])} onChange={() => {}} />)
    expect(screen.getByTestId('check-node-mak')).toBeChecked()
  })

  // A stick's remembered playlists must be visible when the chooser opens, not hidden in
  // closed folders.
  it('opens the folders that hold ticked playlists', () => {
    render(<CheckTree nodes={NODES} checked={new Set(['todas'])} onChange={() => {}} />)
    expect(screen.getByTestId('check-node-todas')).toBeChecked()
  })

  it('finds playlists by name and keeps them tickable', () => {
    render(<CheckTree nodes={NODES} checked={new Set()} onChange={() => {}} />)
    fireEvent.change(screen.getByTestId('check-tree-search'), { target: { value: 'tod' } })
    expect(screen.getByTestId('check-node-todas')).toBeInTheDocument()
    expect(screen.queryByTestId('check-node-house')).toBeNull()
  })
})
