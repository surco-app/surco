// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import '../i18n'
import { SourceTree } from './SourceTree'

afterEach(cleanup)

const TODAS_CANT: SourceNode = { id: 'ct', name: 'Todas', kind: 'playlist', count: 448 }
const TODAS_BASES: SourceNode = { id: 'bt', name: 'Todas', kind: 'playlist', count: 336 }
const NODES: SourceNode[] = [
  {
    id: 'cant',
    name: 'CANTADITAS',
    kind: 'folder',
    count: 1,
    children: [{ id: 'c90', name: '90s', kind: 'folder', count: 1, children: [TODAS_CANT] }],
  },
  { id: 'bases', name: 'BASES', kind: 'folder', count: 1, children: [TODAS_BASES] },
  { id: 'house', name: 'House', kind: 'playlist', count: 32 },
]

function setup(selectedId: string | null = null) {
  const onSelect = vi.fn()
  render(
    <SourceTree
      title="rekordbox"
      source="rekordbox"
      nodes={NODES}
      failed={false}
      selectedId={selectedId}
      onSelect={onSelect}
    />,
  )
  return onSelect
}

describe('SourceTree', () => {
  it('starts with folders closed and opens one on click', () => {
    setup()
    expect(screen.queryByTestId('source-node-ct')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('source-node-cant'))
    fireEvent.click(screen.getByTestId('source-node-c90'))
    expect(screen.getByTestId('source-node-ct')).toHaveTextContent('448')
  })

  it('opens the folders holding the selected playlist, so the selection is never hidden', () => {
    setup('ct')
    expect(screen.getByTestId('source-node-ct')).toHaveAttribute('aria-current', 'true')
  })

  it('hands back the folder path with the playlist, the only thing telling two "Todas" apart', () => {
    const onSelect = setup()
    fireEvent.click(screen.getByTestId('source-node-bases'))
    fireEvent.click(screen.getByTestId('source-node-bt'))
    expect(onSelect).toHaveBeenCalledWith(TODAS_BASES, ['BASES'])
  })

  it('searches playlists by name and shows each hit with its folder path', () => {
    setup()
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'todas' } })
    expect(screen.getByTestId('source-node-ct')).toHaveTextContent('CANTADITAS › 90s')
    expect(screen.getByTestId('source-node-bt')).toHaveTextContent('BASES')
    expect(screen.queryByTestId('source-node-house')).not.toBeInTheDocument()
  })

  it('says when the collection could not be read instead of looking empty', () => {
    render(
      <SourceTree
        title="rekordbox"
        source="rekordbox"
        nodes={undefined}
        failed
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-tree-failed')).toHaveTextContent('read the collection')
  })

  // Music fails when it is closed or Surco was denied control of it; only saying so tells
  // the user there is something to fix, and "collection" is rekordbox's word, not Music's.
  it('points a Music failure at Music being open and Surco being allowed to control it', () => {
    render(
      <SourceTree
        title="Music"
        source="appleMusic"
        nodes={undefined}
        failed
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-tree-failed')).toHaveTextContent(
      'Surco is allowed to control it',
    )
  })
})
