// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { SourceNode } from '../../../shared/types'
import '../i18n'
import { clearDraggedRows, setDraggedRows } from '../lib/reorderDrag'
import { fakeDataTransfer, installDragEvent } from '../test/drag'
import { SourceTree } from './SourceTree'

beforeAll(installDragEvent)
afterEach(cleanup)
afterEach(clearDraggedRows)

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

function setup(selectedId: string | null = null, editable = false) {
  const onSelect = vi.fn()
  const edit = { onCreate: vi.fn(), onDropTracks: vi.fn() }
  const onOuterDrop = vi.fn()
  render(
    // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the window's own file drop
    <div onDrop={onOuterDrop}>
      <SourceTree
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed={false}
        selectedId={selectedId}
        onSelect={onSelect}
        edit={editable ? edit : undefined}
      />
    </div>,
  )
  return Object.assign(onSelect, { edit, onOuterDrop })
}

const files = (...names: string[]) => fakeDataTransfer(names.map((n) => new File([''], n)))

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

  // Opening the way to the selection is a starting point, not a lock: a long folder the
  // user wants out of the way must close on click like any other.
  it('lets the user close a folder that was opened for the selected playlist', () => {
    setup('ct')
    fireEvent.click(screen.getByTestId('source-node-cant'))
    expect(screen.queryByTestId('source-node-ct')).not.toBeInTheDocument()
  })

  it('keeps that folder closed when the tree is re-read on refocus', () => {
    const props = {
      title: 'rekordbox',
      source: 'rekordbox' as const,
      failed: false,
      onSelect: vi.fn(),
    }
    const { rerender } = render(<SourceTree {...props} nodes={NODES} selectedId="ct" />)
    fireEvent.click(screen.getByTestId('source-node-cant'))
    rerender(<SourceTree {...props} nodes={[...NODES]} selectedId="ct" />)
    expect(screen.queryByTestId('source-node-ct')).not.toBeInTheDocument()
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

  // A refocus re-read can fail while rekordbox is mid-write; react-query keeps the last tree,
  // and swapping it for the error would hide every playlist until the next focus.
  it('keeps showing the tree it already read when a later re-read fails', () => {
    render(
      <SourceTree
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-node-cant')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-failed')).not.toBeInTheDocument()
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

describe('SourceTree organising', () => {
  it('creates a playlist at the root, named right in the tree', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit.onCreate).toHaveBeenCalledWith('root', 'Bolo', false)
    expect(screen.queryByTestId('source-tree-name')).not.toBeInTheDocument()
  })

  it('creates a folder inside a folder from its menu, opening it to show where', () => {
    const { edit } = setup(null, true)
    fireEvent.contextMenu(screen.getByTestId('source-node-bases'))
    fireEvent.click(screen.getByTestId('source-tree-new-folder-inside'))
    expect(screen.getByTestId('source-node-bt')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Fijas' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit.onCreate).toHaveBeenCalledWith('bases', 'Fijas', true)
  })

  it('creates nothing for an empty name, and Escape gives up', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-folder'))
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    fireEvent.click(screen.getByTestId('source-tree-new-folder'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'x' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Escape' })
    expect(edit.onCreate).not.toHaveBeenCalled()
  })

  // Finder's rule: clicking away keeps what was typed, and an empty name is no playlist.
  it('creates with the typed name when the field loses focus, and nothing when it is empty', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bolo' } })
    fireEvent.blur(screen.getByTestId('source-tree-name'))
    expect(edit.onCreate).toHaveBeenCalledWith('root', 'Bolo', false)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.blur(screen.getByTestId('source-tree-name'))
    expect(edit.onCreate).toHaveBeenCalledTimes(1)
  })

  it('lights a playlist under a file drag and says how many will land in it', () => {
    const { edit } = setup(null, true)
    const house = screen.getByTestId('source-node-house')
    const dt = files('a.wav', 'b.wav')
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(house).toHaveAttribute('data-drop-target')
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+2 on drop')
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(NODES[2], dt.files)
    expect(house).not.toHaveAttribute('data-drop-target')
  })

  // Rows dragged out of the list are known from the holder; the drop must take them even
  // when the OS drag brings no files into Surco's own window.
  it('takes rows dragged from the list when no files arrive', () => {
    const { edit } = setup(null, true)
    setDraggedRows(['a', 'b', 'c'])
    const house = screen.getByTestId('source-node-house')
    const dt = fakeDataTransfer()
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+3 on drop')
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(NODES[2], [])
  })

  // A folder holds playlists, not tracks; a drop there must neither write anything nor
  // fall through to the window, which would import the files into the list.
  it('takes no drop on a folder and keeps it from reaching the window import', () => {
    const { edit, onOuterDrop } = setup(null, true)
    const bases = screen.getByTestId('source-node-bases')
    const dt = files('a.wav')
    fireEvent.dragOver(bases, { dataTransfer: dt })
    expect(bases).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(bases, { dataTransfer: dt })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })

  it('offers no editing where the source is read-only', () => {
    setup()
    expect(screen.queryByTestId('source-tree-new-playlist')).not.toBeInTheDocument()
    fireEvent.contextMenu(screen.getByTestId('source-node-bases'))
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
  })

  // Cmd-Tab or a click on rekordbox blurs the field without the user having finished typing;
  // committing there would write a half-typed name into the real collection.
  it('keeps the name field open when the window itself loses focus', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Bo' } })
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    fireEvent.blur(screen.getByTestId('source-tree-name'))
    hasFocus.mockRestore()
    expect(edit.onCreate).not.toHaveBeenCalled()
    expect(screen.getByTestId('source-tree-name')).toBeInTheDocument()
  })

  it('creates once when Enter is followed by the blur of the removed field', () => {
    const { edit } = setup(null, true)
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    const field = screen.getByTestId('source-tree-name')
    fireEvent.change(field, { target: { value: 'Bolo' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.blur(field)
    expect(edit.onCreate).toHaveBeenCalledTimes(1)
  })

  it('keeps the highlight while the pointer moves between a playlist and its own children', () => {
    setup(null, true)
    const house = screen.getByTestId('source-node-house')
    const dt = files('a.wav')
    fireEvent.dragOver(house, { dataTransfer: dt })
    fireEvent.dragLeave(house, { relatedTarget: house.querySelector('span') })
    expect(house).toHaveAttribute('data-drop-target')
    fireEvent.dragLeave(house, { relatedTarget: document.body })
    expect(house).not.toHaveAttribute('data-drop-target')
  })

  it('keeps a drop on the title or the search box from reaching the window import', () => {
    const { edit, onOuterDrop } = setup(null, true)
    fireEvent.drop(screen.getByTestId('source-tree-search'), { dataTransfer: files('a.wav') })
    fireEvent.drop(screen.getByText('rekordbox'), { dataTransfer: files('a.wav') })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })

  it('clears an active search when a playlist is created, so the new field is visible', () => {
    setup(null, true)
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'house' } })
    fireEvent.click(screen.getByTestId('source-tree-new-playlist'))
    expect(screen.getByTestId('source-tree-search')).toHaveValue('')
    expect(screen.getByTestId('source-tree-name')).toBeInTheDocument()
  })

  it('counts only files of a Finder drag, not the text or links that ride along', () => {
    setup(null, true)
    const house = screen.getByTestId('source-node-house')
    const dt = files('a.wav', 'b.wav')
    dt.items = [{ kind: 'file' }, { kind: 'file' }, { kind: 'string' }]
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+2 on drop')
  })
})
