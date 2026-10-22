// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { SourceNode } from '../../../shared/types'
import i18n from '../i18n'
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

function setup(selectedId: string | null = null, editable = false, nodes = NODES) {
  const onSelect = vi.fn()
  const edit = {
    onCreate: vi.fn(),
    onDropTracks: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  }
  const onOuterDrop = vi.fn()
  render(
    // biome-ignore lint/a11y/noStaticElementInteractions: stands in for the window's own file drop
    <div onDrop={onOuterDrop}>
      <SourceTree
        width={236}
        title="rekordbox"
        source="rekordbox"
        nodes={nodes}
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
  it('takes the width the window layout hands it instead of a fixed one', () => {
    render(
      <SourceTree
        width={251}
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-tree')).toHaveStyle({ width: '251px' })
  })

  it('starts with folders closed and opens one on click', () => {
    setup()
    expect(screen.queryByTestId('source-node-ct')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('source-node-cant'))
    fireEvent.click(screen.getByTestId('source-node-c90'))
    expect(screen.getByTestId('source-node-ct')).toHaveTextContent('448')
  })

  it('counts tracks only on playlists, since a folder holds playlists and its number read as tracks', () => {
    setup()
    expect(screen.getByTestId('source-node-house')).toHaveTextContent('32')
    expect(screen.getByTestId('source-node-cant')).toHaveTextContent(/^CANTADITAS$/)
    expect(screen.getByTestId('source-node-bases')).toHaveTextContent(/^BASES$/)
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
      width: 236,
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

  it('says where to set the Engine DJ library when there is none, instead of looking like a library with no playlists', () => {
    render(
      <SourceTree
        width={236}
        title="Engine DJ"
        source="engine"
        nodes={[]}
        failed={false}
        missing
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByTestId('source-tree-missing')).toHaveTextContent('Settings → Output')
    expect(screen.queryByText(i18n.t('sources.empty'))).not.toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-new-playlist')).not.toBeInTheDocument()
  })

  it('says when the collection could not be read instead of looking empty', () => {
    render(
      <SourceTree
        width={236}
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
        width={236}
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
        width={236}
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

  // The export reads rekordbox's tree, so it is offered from that tree's header, and only
  // where App says it can run.
  it('offers the USB export only when asked to', () => {
    const onExportUsb = vi.fn()
    const props = {
      title: 'rekordbox',
      width: 236,
      source: 'rekordbox' as const,
      nodes: NODES,
      failed: false,
      selectedId: null,
      onSelect: () => {},
    }
    const { rerender } = render(<SourceTree {...props} />)
    expect(screen.queryByTestId('source-tree-export-usb')).toBeNull()
    rerender(<SourceTree {...props} onExportUsb={onExportUsb} />)
    fireEvent.click(screen.getByTestId('source-tree-export-usb'))
    expect(onExportUsb).toHaveBeenCalled()
  })
})

describe('SourceTree organising', () => {
  // "los iconos no tienen tooltip": two bare glyphs side by side, and nothing on hover said
  // which one makes a playlist and which a folder.
  it('names the create buttons in a tooltip on hover', () => {
    vi.useFakeTimers()
    setup(null, true)
    for (const [id, key] of [
      ['source-tree-new-playlist', 'sources.tree.newPlaylist'],
      ['source-tree-new-folder', 'sources.tree.newFolder'],
    ]) {
      const button = screen.getByTestId(id)
      fireEvent.pointerEnter(button)
      fireEvent.pointerMove(button, { clientX: 10, clientY: 10 })
      act(() => vi.advanceTimersByTime(500))
      expect(screen.getByRole('tooltip')).toHaveTextContent(i18n.t(key))
      fireEvent.pointerLeave(button)
    }
    vi.useRealTimers()
  })

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

  // A record outlives a drag-out that ended in Finder. A link or text dragged from a browser
  // afterwards is not those rows: taking it would write them into the DJ's playlist unasked.
  it('takes no link or text drag for the rows of an earlier drag-out', () => {
    const { edit } = setup(null, true)
    setDraggedRows(['a', 'b', 'c'])
    const house = screen.getByTestId('source-node-house')
    const dt = fakeDataTransfer()
    dt.setData('text/uri-list', 'https://example.com')
    fireEvent.dragOver(house, { dataTransfer: dt })
    expect(house).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
  })

  // The count is what the drop will add: Finder's files, not the rows of a stale record.
  it('counts the files of a Finder drag, not the rows of an earlier drag-out', () => {
    setup(null, true)
    setDraggedRows(['a', 'b', 'c'])
    fireEvent.dragOver(screen.getByTestId('source-node-house'), { dataTransfer: files('x.wav') })
    expect(screen.getByTestId('source-drop-count')).toHaveTextContent('+1 on drop')
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

// The folder menu opens at the click; from a folder low in a long tree its items ran past
// the bottom of the window, out of reach.
describe('SourceTree folder menu placement', () => {
  const size = { width: window.innerWidth, height: window.innerHeight }
  afterEach(() => {
    vi.restoreAllMocks()
    Object.assign(window, { innerWidth: size.width, innerHeight: size.height })
  })
  const openAt = (clientX: number, clientY: number) => {
    Object.assign(window, { innerWidth: 1200, innerHeight: 882 })
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset.testid !== 'source-tree-menu') return new DOMRect(0, 0, 0, 0)
      return new DOMRect(0, 0, 190, 80)
    })
    setup(null, true)
    fireEvent.contextMenu(screen.getByTestId('source-node-bases'), { clientX, clientY })
    return screen.getByTestId('source-tree-menu')
  }

  it('stays inside the window when opened near its bottom right corner', () => {
    const menu = openAt(1150, 860)
    expect(Number.parseFloat(menu.style.left) + 190).toBeLessThanOrEqual(1200)
    expect(Number.parseFloat(menu.style.top) + 80).toBeLessThanOrEqual(882)
  })

  it('opens at the click when it fits', () => {
    const menu = openAt(100, 200)
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
  })
})

describe('SourceTree rename and delete', () => {
  const openMenu = (id: string) =>
    fireEvent.contextMenu(screen.getByTestId(`source-node-${id}`), { clientX: 10, clientY: 10 })

  it('offers Rename and Delete on a playlist', () => {
    setup(null, true)
    openMenu('house')
    expect(screen.getByTestId('source-tree-rename')).toBeInTheDocument()
    expect(screen.getByTestId('source-tree-delete')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-new-playlist-inside')).toBeNull()
  })

  it('renames in place, Enter keeps the name and Escape drops it', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    const field = screen.getByTestId('source-tree-rename-field')
    expect(field).toHaveValue('House')
    fireEvent.change(field, { target: { value: 'House 26' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(edit.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'house' }), 'House 26')
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    fireEvent.keyDown(screen.getByTestId('source-tree-rename-field'), { key: 'Escape' })
    expect(edit.onRename).toHaveBeenCalledTimes(1)
  })

  it('writes nothing for an unchanged name', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    fireEvent.keyDown(screen.getByTestId('source-tree-rename-field'), { key: 'Enter' })
    expect(edit.onRename).not.toHaveBeenCalled()
  })

  it('writes nothing for an empty name', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    const field = screen.getByTestId('source-tree-rename-field')
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(edit.onRename).not.toHaveBeenCalled()
  })

  it('confirms a folder delete with what it holds and says the tracks stay', () => {
    const { edit } = setup(null, true)
    openMenu('cant')
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    expect(
      screen.getByText(
        'Delete the folder “CANTADITAS” and what is inside? 1 playlist and 1 folder. The tracks stay in the collection.',
      ),
    ).toBeInTheDocument()
    expect(edit.onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('confirm-ok'))
    expect(edit.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'cant' }))
  })

  it('shows the rename field for a search hit inside a closed folder', () => {
    setup(null, true)
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'todas' } })
    openMenu('ct')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    expect(screen.getByTestId('source-tree-rename-field')).toHaveValue('Todas')
  })

  it('keeps the children of an open folder visible while it is renamed', () => {
    setup(null, true)
    fireEvent.click(screen.getByTestId('source-node-bases'))
    openMenu('bases')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    expect(screen.getByTestId('source-tree-rename-field')).toHaveValue('BASES')
    expect(screen.getByTestId('source-node-bt')).toBeInTheDocument()
  })

  it('keeps the new name when the field loses focus', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-rename'))
    const field = screen.getByTestId('source-tree-rename-field')
    fireEvent.change(field, { target: { value: 'House 26' } })
    fireEvent.blur(field)
    expect(edit.onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'house' }), 'House 26')
  })

  it('sends nothing when the delete confirmation is cancelled', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    fireEvent.click(screen.getByTestId('confirm-cancel'))
    expect(edit.onDelete).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-ok')).toBeNull()
  })

  it('confirms a playlist delete before anything is sent', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    expect(
      screen.getByText('Delete the playlist “House”? The tracks stay in the collection.'),
    ).toBeInTheDocument()
    expect(edit.onDelete).not.toHaveBeenCalled()
  })
})

describe('SourceTree Recently added', () => {
  const RECENT: SourceNode = {
    id: RECENTLY_ADDED_ID,
    name: 'Recently added',
    kind: 'playlist',
    count: 12,
  }
  const node = () => screen.getByTestId(`source-node-${RECENTLY_ADDED_ID}`)

  it('marks it with a clock, so it reads as Surco’s list and not one of the DJ’s playlists', () => {
    setup(null, true, [RECENT, ...NODES])
    expect(screen.getByTestId('source-node-recent-icon')).toBeInTheDocument()
    expect(screen.getAllByTestId('source-node-recent-icon')).toHaveLength(1)
  })

  it('opens like any playlist', () => {
    const onSelect = setup(null, true, [RECENT, ...NODES])
    fireEvent.click(node())
    expect(onSelect).toHaveBeenCalledWith(RECENT, [])
  })

  // It is not a rekordbox playlist: a rename or delete would be sent to a playlist that
  // does not exist in the collection.
  it('offers no rename or delete', () => {
    setup(null, true, [RECENT, ...NODES])
    fireEvent.contextMenu(node(), { clientX: 10, clientY: 10 })
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
  })

  // What is in it is decided by when tracks entered the collection, so a drop has nowhere to
  // go, and it must not fall through to the window import either.
  it('takes no drop and keeps it from reaching the window import', () => {
    const { edit, onOuterDrop } = setup(null, true, [RECENT, ...NODES])
    const dt = files('a.wav')
    fireEvent.dragOver(node(), { dataTransfer: dt })
    expect(node()).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(node(), { dataTransfer: dt })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })
})
