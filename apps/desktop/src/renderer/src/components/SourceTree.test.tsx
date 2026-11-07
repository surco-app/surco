// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ALL_TRACKS_ID } from '../../../shared/allTracks'
import { RECENTLY_ADDED_ID } from '../../../shared/recentlyAdded'
import type { SourceNode } from '../../../shared/types'
import i18n from '../i18n'
import type { NewPlaylist } from '../lib/commands'
import { clearDraggedRows, setDraggedRows, TREE_NODE_TYPE } from '../lib/reorderDrag'
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
    onPasteTracklist: vi.fn(),
    onMove: vi.fn(),
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

const dragNode = (id: string) => {
  const dt = fakeDataTransfer()
  fireEvent.dragStart(screen.getByTestId(`source-node-${id}`), { dataTransfer: dt })
  return dt
}

const over = (el: HTMLElement, y: number, dt: ReturnType<typeof fakeDataTransfer>) => {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 28 } as DOMRect)
  fireEvent.dragOver(el, { dataTransfer: dt, clientY: y })
}

describe('SourceTree', () => {
  it('draws placeholder rows in the shape of the playlists while the tree is read', () => {
    render(
      <SourceTree
        width={236}
        title="Music"
        source="appleMusic"
        nodes={undefined}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    )
    const loading = screen.getByTestId('source-tree-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveTextContent('Reading playlists…')
    expect(within(loading).getAllByTestId('source-tree-skeleton-row')).toHaveLength(8)
  })

  it('keeps Traktor’s own playlists from being renamed or deleted, and HISTORY from taking tracks', () => {
    const PREP: SourceNode = { id: 'prep', name: 'Preparation', kind: 'playlist', count: 0 }
    const HIST: SourceNode = { id: 'hist', name: 'HISTORY', kind: 'playlist', count: 0 }
    const edit = { onCreate: vi.fn(), onDropTracks: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() }
    render(
      <SourceTree
        width={236}
        title="Traktor"
        source="traktor"
        nodes={[PREP, HIST, ...NODES]}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={edit}
        fixed={(n) => (n.id === 'hist' ? 'locked' : n.id === 'prep' ? 'tracks-only' : null)}
      />,
    )
    fireEvent.contextMenu(screen.getByTestId('source-node-prep'))
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
    const dt = files('a.wav')
    fireEvent.dragOver(screen.getByTestId('source-node-prep'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('source-node-prep'), { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(PREP, dt.files)
    fireEvent.dragOver(screen.getByTestId('source-node-hist'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('source-node-hist'), { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledTimes(1)
    fireEvent.contextMenu(screen.getByTestId('source-node-house'))
    expect(screen.getByTestId('source-tree-menu')).toBeInTheDocument()
  })

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

  it('hands the command palette its own Nueva playlist, only where the library can be edited', () => {
    const newPlaylistRef: { current: NewPlaylist | null } = { current: null }
    const onCreate = vi.fn()
    const tree = (editable: boolean) => (
      <SourceTree
        width={236}
        title="Traktor"
        source="traktor"
        nodes={NODES}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={
          editable
            ? { onCreate, onDropTracks: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() }
            : undefined
        }
        newPlaylistRef={newPlaylistRef}
      />
    )
    const { rerender, unmount } = render(tree(false))
    expect(newPlaylistRef.current).toBeNull()
    rerender(tree(true))
    expect(newPlaylistRef.current?.source).toBe('traktor')
    act(() => newPlaylistRef.current?.run())
    const field = screen.getByTestId('source-tree-name')
    expect(field).toHaveFocus()
    fireEvent.change(field, { target: { value: 'Bolo' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onCreate).toHaveBeenCalledWith('root', 'Bolo', false)
    unmount()
    expect(newPlaylistRef.current).toBeNull()
  })

  it('keeps the name field focused when the palette that ran it hands focus back as it closes', () => {
    const newPlaylistRef: { current: NewPlaylist | null } = { current: null }
    const edit = { onCreate: vi.fn(), onDropTracks: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() }
    function Palette({ opener }: { opener: HTMLElement }) {
      useEffect(() => () => opener.focus(), [opener])
      return null
    }
    function Harness() {
      const [open, setOpen] = useState(true)
      const opener = document.getElementById('opener') as HTMLElement
      return (
        <>
          <SourceTree
            width={236}
            title="rekordbox"
            source="rekordbox"
            nodes={NODES}
            failed={false}
            selectedId={null}
            onSelect={vi.fn()}
            edit={edit}
            newPlaylistRef={newPlaylistRef}
          />
          {open && <Palette opener={opener} />}
          <button
            type="button"
            data-testid="palette-run"
            onClick={() => {
              newPlaylistRef.current?.run()
              setOpen(false)
            }}
          />
        </>
      )
    }
    const opener = document.createElement('button')
    opener.id = 'opener'
    document.body.append(opener)
    render(<Harness />)
    fireEvent.click(screen.getByTestId('palette-run'))
    expect(screen.getByTestId('source-tree-name')).toHaveFocus()
    opener.remove()
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

  it('takes no node dropped before, after or on it, since its place is Surco’s and not the collection’s', () => {
    const { edit, onOuterDrop } = setup(null, true, [RECENT, ...NODES])
    const dt = dragNode('house')
    over(node(), 3, dt)
    expect(screen.queryByTestId('source-tree-drop-line')).toBeNull()
    expect(node()).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(node(), { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })
})

describe('SourceTree All tracks', () => {
  const ALL: SourceNode = { id: ALL_TRACKS_ID, name: 'All tracks', kind: 'playlist', count: 2078 }
  const node = () => screen.getByTestId(`source-node-${ALL_TRACKS_ID}`)

  it('marks it with its own icon, so it reads as the whole collection and not a playlist', () => {
    setup(null, true, [ALL, ...NODES])
    expect(within(node()).getByTestId('source-node-all-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('source-node-recent-icon')).not.toBeInTheDocument()
  })

  it('shows the whole collection’s count', () => {
    setup(null, true, [ALL, ...NODES])
    expect(node()).toHaveTextContent('2078')
  })

  // It is the collection, not a playlist in it: a rename or delete would be sent to a
  // playlist that does not exist.
  it('offers no rename or delete', () => {
    setup(null, true, [ALL, ...NODES])
    fireEvent.contextMenu(node(), { clientX: 10, clientY: 10 })
    expect(screen.queryByTestId('source-tree-menu')).not.toBeInTheDocument()
  })

  // Everything in the collection is already in it, so a drop has nowhere to go, and it must
  // not fall through to the window import either.
  it('takes no drop and keeps it from reaching the window import', () => {
    const { edit, onOuterDrop } = setup(null, true, [ALL, ...NODES])
    const dt = files('a.wav')
    fireEvent.dragOver(node(), { dataTransfer: dt })
    expect(node()).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(node(), { dataTransfer: dt })
    expect(edit.onDropTracks).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })

  it('takes no node dropped before, after or on it, since it is the collection and not a place in it', () => {
    const { edit, onOuterDrop } = setup(null, true, [ALL, ...NODES])
    const dt = dragNode('house')
    over(node(), 24, dt)
    expect(screen.queryByTestId('source-tree-drop-line')).toBeNull()
    expect(node()).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(node(), { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
    expect(onOuterDrop).not.toHaveBeenCalled()
  })
})

describe('SourceTree on Serato crates', () => {
  const CRATES: SourceNode[] = [
    {
      id: 'A',
      name: 'A',
      kind: 'folder',
      count: 2,
      children: [
        {
          id: 'A%%B',
          name: 'B',
          kind: 'folder',
          count: 1,
          children: [{ id: 'A%%B%%C', name: 'C', kind: 'playlist', count: 1 }],
        },
      ],
    },
    { id: 'Z', name: 'Z', kind: 'playlist', count: 0 },
  ]

  function setupCrates(nodes: SourceNode[] = CRATES) {
    const onSelect = vi.fn()
    const edit = {
      onCreate: vi.fn(),
      onDropTracks: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onMove: vi.fn(),
      crates: true as const,
    }
    render(
      <SourceTree
        width={236}
        title="Serato"
        source="serato"
        nodes={nodes}
        failed={false}
        selectedId={null}
        onSelect={onSelect}
        edit={edit}
      />,
    )
    return Object.assign(edit, { onSelect })
  }

  const PARENT: SourceNode[] = [
    {
      id: 'P',
      name: 'Parent',
      kind: 'playlist',
      count: 5,
      children: [
        { id: 'P%%Q', name: 'Q', kind: 'playlist', count: 1 },
        {
          id: 'P%%R',
          name: 'R',
          kind: 'playlist',
          count: 2,
          children: [{ id: 'P%%R%%S', name: 'Sub', kind: 'playlist', count: 1 }],
        },
      ],
    },
  ]

  it('opens a crate that holds subcrates on a click, listing its own tracks, and expands it from the chevron', () => {
    const { onSelect } = setupCrates(PARENT)
    const parent = screen.getByTestId('source-node-P')
    expect(parent).toHaveTextContent('5')
    fireEvent.click(parent)
    expect(onSelect).toHaveBeenCalledWith(PARENT[0], [])
    expect(screen.queryByTestId('source-node-P%%Q')).toBeNull()
    const chevron = screen.getByTestId('source-node-expand-P')
    expect(chevron).toHaveAttribute('aria-expanded', 'false')
    expect(chevron).toHaveAccessibleName('Subcrates of Parent')
    fireEvent.click(chevron)
    expect(chevron).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('source-node-P%%Q')).toBeInTheDocument()
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('takes tracks dropped on a crate that holds subcrates', () => {
    const edit = setupCrates(PARENT)
    const parent = screen.getByTestId('source-node-P')
    const dt = files('a.mp3')
    fireEvent.dragOver(parent, { dataTransfer: dt })
    fireEvent.drop(parent, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(PARENT[0], expect.any(Array))
  })

  it('counts the subcrates nested under a crate that holds tracks when confirming its delete', () => {
    setupCrates(PARENT)
    fireEvent.contextMenu(screen.getByTestId('source-node-P'))
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Delete the crate “Parent” and its 3 subcrates? The tracks stay in Serato.',
    )
  })

  it('lists each hit once while searching, with no subcrates unfolded under a matching parent crate', () => {
    setupCrates(PARENT)
    fireEvent.click(screen.getByTestId('source-node-expand-P'))
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'r' } })
    expect(screen.getAllByTestId('source-node-P%%R')).toHaveLength(1)
    expect(screen.queryByTestId('source-node-expand-P')).toBeNull()
    expect(screen.queryByTestId('source-node-P%%Q')).toBeNull()
  })

  it('takes tracks dropped on the chevron of a crate that holds subcrates into that crate', () => {
    const edit = setupCrates(PARENT)
    const chevron = screen.getByTestId('source-node-expand-P')
    const dt = files('a.mp3')
    fireEvent.dragOver(chevron, { dataTransfer: dt })
    expect(screen.getByTestId('source-node-P')).toHaveAttribute('data-drop-target', 'true')
    fireEvent.drop(chevron, { dataTransfer: dt })
    expect(edit.onDropTracks).toHaveBeenCalledWith(PARENT[0], expect.any(Array))
  })

  it('finds a subcrate of a crate that holds tracks, and the crate itself, in the search', () => {
    setupCrates(PARENT)
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'sub' } })
    expect(screen.getByTestId('source-node-P%%R%%S')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'parent' } })
    expect(screen.getByTestId('source-node-P')).toBeInTheDocument()
  })

  it('offers a new crate in the header and never a folder', () => {
    setupCrates()
    expect(screen.getByTestId('source-tree-new-playlist')).toHaveAttribute(
      'aria-label',
      'New crate',
    )
    expect(screen.queryByTestId('source-tree-new-folder')).toBeNull()
  })

  it('offers a new crate inside any crate, not a folder, since a crate can hold crates', () => {
    const edit = setupCrates()
    fireEvent.contextMenu(screen.getByTestId('source-node-Z'))
    expect(screen.getByTestId('source-tree-new-playlist-inside')).toHaveTextContent('New crate')
    expect(screen.queryByTestId('source-tree-new-folder-inside')).toBeNull()
    fireEvent.click(screen.getByTestId('source-tree-new-playlist-inside'))
    fireEvent.change(screen.getByTestId('source-tree-name'), { target: { value: 'Sub' } })
    fireEvent.keyDown(screen.getByTestId('source-tree-name'), { key: 'Enter' })
    expect(edit.onCreate).toHaveBeenCalledWith('Z', 'Sub', false)
  })

  it('confirms a delete in crate words, counting every descendant subcrate', () => {
    setupCrates()
    fireEvent.contextMenu(screen.getByTestId('source-node-A'))
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Delete the crate “A” and its 2 subcrates? The tracks stay in Serato.',
    )
  })

  it('treats the whole crate row as inside and draws no line on Serato, where a crate is never placed between others', () => {
    const Y: SourceNode = { id: 'Y', name: 'Y', kind: 'playlist', count: 0 }
    const edit = setupCrates([Y, CRATES[1]])
    const dt = dragNode('Z')
    const target = screen.getByTestId('source-node-Y')
    over(target, 3, dt)
    expect(target).toHaveAttribute('data-drop-target')
    expect(screen.queryByTestId('source-tree-drop-line')).toBeNull()
    fireEvent.drop(target, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(CRATES[1], 'Y', null, ['Y'])
  })

  it('sends nothing for a crate dropped back on the crate it sits under, since Serato has no order to change', () => {
    const edit = setupCrates(PARENT)
    fireEvent.click(screen.getByTestId('source-node-expand-P'))
    const dt = dragNode('P%%Q')
    const parent = screen.getByTestId('source-node-P')
    over(parent, 14, dt)
    fireEvent.drop(parent, { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  it('sends nothing for a root crate dropped on the end of the tree, where it already is', () => {
    const edit = setupCrates()
    const dt = dragNode('A')
    const end = screen.getByTestId('source-tree-drop-end')
    fireEvent.dragOver(end, { dataTransfer: dt })
    fireEvent.drop(end, { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  const CLASH: SourceNode[] = [
    {
      id: 'A',
      name: 'A',
      kind: 'folder',
      count: 1,
      children: [{ id: 'A%%B', name: 'B', kind: 'playlist', count: 1 }],
    },
    {
      id: 'D',
      name: 'D',
      kind: 'folder',
      count: 1,
      children: [{ id: 'D%%b', name: 'b', kind: 'playlist', count: 1 }],
    },
    { id: 'b', name: 'b', kind: 'playlist', count: 0 },
  ]

  it('refuses a crate over a crate that already holds one of its name in any case, since Serato would refuse the move', () => {
    const edit = setupCrates(CLASH)
    fireEvent.click(screen.getByTestId('source-node-A'))
    const dt = dragNode('A%%B')
    const target = screen.getByTestId('source-node-D')
    over(target, 14, dt)
    expect(target).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(target, { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  it('refuses a crate on the end of the tree when a root crate already has its name', () => {
    const edit = setupCrates(CLASH)
    fireEvent.click(screen.getByTestId('source-node-A'))
    const dt = dragNode('A%%B')
    const end = screen.getByTestId('source-tree-drop-end')
    expect(fireEvent.dragOver(end, { dataTransfer: dt })).toBe(true)
    fireEvent.drop(end, { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  it('confirms a delete of a crate with no subcrates in short words', () => {
    setupCrates()
    fireEvent.contextMenu(screen.getByTestId('source-node-Z'))
    fireEvent.click(screen.getByTestId('source-tree-delete'))
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Delete the crate “Z”? The tracks stay in Serato.',
    )
  })
})

describe('SourceTree paste tracklist', () => {
  const openMenu = (id: string) =>
    fireEvent.contextMenu(screen.getByTestId(`source-node-${id}`), { clientX: 10, clientY: 10 })

  it('offers Paste tracklist on a playlist and hands the node over', () => {
    const { edit } = setup(null, true)
    openMenu('house')
    const item = screen.getByTestId('source-tree-paste-tracklist')
    expect(item).toHaveTextContent('Paste tracklist…')
    fireEvent.click(item)
    expect(edit.onPasteTracklist).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'house' }),
      false,
    )
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  })

  it('offers a new playlist from a tracklist on a folder', () => {
    const { edit } = setup(null, true)
    openMenu('bases')
    const item = screen.getByTestId('source-tree-paste-tracklist')
    expect(item).toHaveTextContent('Playlist from tracklist…')
    fireEvent.click(item)
    expect(edit.onPasteTracklist).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bases' }),
      true,
    )
  })

  it('groups the tracklist item with the creating items, before Rename and Delete', () => {
    setup(null, true)
    openMenu('bases')
    const items = within(screen.getByTestId('source-tree-menu')).getAllByRole('menuitem')
    expect(items.map((i) => i.getAttribute('data-testid'))).toEqual([
      'source-tree-new-playlist-inside',
      'source-tree-new-folder-inside',
      'source-tree-paste-tracklist',
      'source-tree-rename',
      'source-tree-delete',
    ])
  })

  it('opens a paste-only menu on a tracks-only playlist and none on a locked one', () => {
    const edit = {
      onCreate: vi.fn(),
      onDropTracks: vi.fn(),
      onRename: vi.fn(),
      onDelete: vi.fn(),
      onPasteTracklist: vi.fn(),
    }
    render(
      <SourceTree
        width={236}
        title="Traktor"
        source="traktor"
        nodes={NODES}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={edit}
        fixed={(n) => (n.id === 'house' ? 'tracks-only' : n.id === 'bases' ? 'locked' : null)}
      />,
    )
    openMenu('house')
    expect(screen.getByTestId('source-tree-paste-tracklist')).toBeInTheDocument()
    expect(screen.queryByTestId('source-tree-rename')).toBeNull()
    expect(screen.queryByTestId('source-tree-delete')).toBeNull()
    fireEvent.click(screen.getByTestId('source-tree-paste-tracklist'))
    expect(edit.onPasteTracklist).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'house' }),
      false,
    )
    openMenu('bases')
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
  })

  it('shows nothing of it when the tree was given no paste handler', () => {
    const edit = { onCreate: vi.fn(), onDropTracks: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() }
    render(
      <SourceTree
        width={236}
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={edit}
      />,
    )
    openMenu('house')
    expect(screen.queryByTestId('source-tree-paste-tracklist')).toBeNull()
  })
})

describe('SourceTree dragging nodes', () => {
  const editOnly = {
    onCreate: vi.fn(),
    onDropTracks: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
  }
  const draw = (nodes: SourceNode[], fixed?: (n: SourceNode) => 'locked' | 'tracks-only' | null) =>
    render(
      <SourceTree
        width={236}
        title="Traktor"
        source="traktor"
        nodes={nodes}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={editOnly}
        fixed={fixed}
      />,
    )
  const house = NODES[2]

  it('lets playlists and folders be dragged where the tree can be edited, and nothing where it cannot', () => {
    setup(null, true)
    expect(screen.getByTestId('source-node-house')).toHaveAttribute('draggable', 'true')
    expect(screen.getByTestId('source-node-bases')).toHaveAttribute('draggable', 'true')
    cleanup()
    setup(null, false)
    expect(screen.getByTestId('source-node-house')).not.toHaveAttribute('draggable', 'true')
  })

  it('does not drag while the edit has no way to move', () => {
    const { onMove: _, ...withoutMove } = editOnly
    render(
      <SourceTree
        width={236}
        title="rekordbox"
        source="rekordbox"
        nodes={NODES}
        failed={false}
        selectedId={null}
        onSelect={vi.fn()}
        edit={withoutMove}
      />,
    )
    expect(screen.getByTestId('source-node-house')).not.toHaveAttribute('draggable', 'true')
  })

  it('never drags Recently added or All tracks', () => {
    const recent: SourceNode = { id: RECENTLY_ADDED_ID, name: 'Recent', kind: 'playlist', count: 1 }
    const all: SourceNode = { id: ALL_TRACKS_ID, name: 'All', kind: 'playlist', count: 1 }
    draw([recent, all, house])
    expect(screen.getByTestId(`source-node-${RECENTLY_ADDED_ID}`)).not.toHaveAttribute(
      'draggable',
      'true',
    )
    expect(screen.getByTestId(`source-node-${ALL_TRACKS_ID}`)).not.toHaveAttribute(
      'draggable',
      'true',
    )
    expect(screen.getByTestId('source-node-house')).toHaveAttribute('draggable', 'true')
  })

  it('never drags Traktor’s own playlists, locked or tracks-only', () => {
    const prep: SourceNode = { id: 'prep', name: 'Preparation', kind: 'playlist', count: 0 }
    const hist: SourceNode = { id: 'hist', name: 'HISTORY', kind: 'playlist', count: 0 }
    draw([prep, hist, house], (n) =>
      n.id === 'hist' ? 'locked' : n.id === 'prep' ? 'tracks-only' : null,
    )
    expect(screen.getByTestId('source-node-prep')).not.toHaveAttribute('draggable', 'true')
    expect(screen.getByTestId('source-node-hist')).not.toHaveAttribute('draggable', 'true')
    expect(screen.getByTestId('source-node-house')).toHaveAttribute('draggable', 'true')
  })

  it('never drags a pending node', () => {
    const pending: SourceNode = { id: 'pending:x', name: 'New', kind: 'playlist', count: 0 }
    draw([pending, house])
    expect(screen.getByTestId('source-node-pending:x')).not.toHaveAttribute('draggable', 'true')
  })

  it('never drags a search hit', () => {
    setup(null, true)
    fireEvent.change(screen.getByTestId('source-tree-search'), { target: { value: 'House' } })
    expect(screen.getByTestId('source-node-house')).not.toHaveAttribute('draggable', 'true')
  })

  it('carries the node id under its own type and marks the row while it is dragged', () => {
    setup(null, true)
    const row = screen.getByTestId('source-node-house')
    const dt = fakeDataTransfer()
    fireEvent.dragStart(row, { dataTransfer: dt })
    expect(dt.getData(TREE_NODE_TYPE)).toBe('house')
    expect(dt.effectAllowed).toBe('move')
    expect(row).toHaveAttribute('data-dragging')
    fireEvent.dragEnd(row, { dataTransfer: dt })
    expect(row).not.toHaveAttribute('data-dragging')
  })

  it('keeps a pending node inert: no selection, no menu, no track drop', () => {
    const pending: SourceNode = { id: 'pending:x', name: 'New', kind: 'playlist', count: 0 }
    const onSelect = setup(null, true, [...NODES, pending])
    const row = screen.getByTestId('source-node-pending:x')
    fireEvent.click(row)
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.contextMenu(row)
    expect(screen.queryByTestId('source-tree-menu')).toBeNull()
    fireEvent.dragOver(row, { dataTransfer: files('a.wav') })
    expect(row).not.toHaveAttribute('data-drop-target')
  })
})

describe('SourceTree dropping nodes', () => {
  it('draws the line before a folder from its upper quarter, and moves there on drop', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('house')
    const bases = screen.getByTestId('source-node-bases')
    over(bases, 3, dt)
    expect(screen.getByTestId('source-tree-drop-line')).toBeInTheDocument()
    fireEvent.drop(bases, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(NODES[2], 'root', 'bases', [])
  })

  it('drops inside a folder from its middle, opens it, and shows no line', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('house')
    const bases = screen.getByTestId('source-node-bases')
    over(bases, 14, dt)
    expect(bases).toHaveAttribute('data-drop-target')
    expect(screen.queryByTestId('source-tree-drop-line')).toBeNull()
    fireEvent.drop(bases, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(NODES[2], 'bases', null, ['BASES'])
    expect(bases).toHaveAttribute('aria-expanded', 'true')
  })

  it('draws the line after a folder from its lower quarter, and moves before its next sibling on drop', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('house')
    const cant = screen.getByTestId('source-node-cant')
    over(cant, 26, dt)
    expect(screen.getByTestId('source-tree-drop-line')).toBeInTheDocument()
    expect(cant).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(cant, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(NODES[2], 'root', 'bases', [])
  })

  it('draws the line after a playlist from its lower half, and moves last when it is the last row', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('cant')
    const house = screen.getByTestId('source-node-house')
    over(house, 20, dt)
    expect(screen.getByTestId('source-tree-drop-line')).toBeInTheDocument()
    fireEvent.drop(house, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(NODES[0], 'root', null, [])
  })

  it('indents the line to the depth of the parent it lands in', () => {
    setup('ct', true)
    const dt = dragNode('house')
    over(screen.getByTestId('source-node-c90'), 3, dt)
    expect(screen.getByTestId('source-tree-drop-line')).toHaveStyle({ paddingLeft: '28px' })
  })

  it('lands last at the root when dropped under the last row', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('cant')
    const end = screen.getByTestId('source-tree-drop-end')
    fireEvent.dragOver(end, { dataTransfer: dt })
    fireEvent.drop(end, { dataTransfer: dt })
    expect(edit.onMove).toHaveBeenCalledWith(NODES[0], 'root', null, [])
  })

  it('refuses a folder as a target inside itself or its children', () => {
    const { edit } = setup('ct', true)
    const dt = dragNode('cant')
    const c90 = screen.getByTestId('source-node-c90')
    over(c90, 14, dt)
    expect(c90).not.toHaveAttribute('data-drop-target')
    fireEvent.drop(c90, { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  it('sends nothing for a drop on the place the node already has', () => {
    const { edit } = setup(null, true)
    const dt = dragNode('bases')
    over(screen.getByTestId('source-node-house'), 3, dt)
    fireEvent.drop(screen.getByTestId('source-node-house'), { dataTransfer: dt })
    fireEvent.dragStart(screen.getByTestId('source-node-bases'), { dataTransfer: dt })
    over(screen.getByTestId('source-node-cant'), 24, dt)
    fireEvent.drop(screen.getByTestId('source-node-cant'), { dataTransfer: dt })
    expect(edit.onMove).not.toHaveBeenCalled()
  })

  it('accepts the drag only over a place it can land, so a refused row keeps the no-drop cursor', () => {
    setup('ct', true)
    const dt = dragNode('cant')
    const c90 = screen.getByTestId('source-node-c90')
    vi.spyOn(c90, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 28 } as DOMRect)
    expect(fireEvent.dragOver(c90, { dataTransfer: dt, clientY: 14 })).toBe(true)
    const house = screen.getByTestId('source-node-house')
    vi.spyOn(house, 'getBoundingClientRect').mockReturnValue({ top: 0, height: 28 } as DOMRect)
    expect(fireEvent.dragOver(house, { dataTransfer: dt, clientY: 3 })).toBe(false)
    expect(
      fireEvent.dragOver(screen.getByTestId('source-tree-drop-end'), { dataTransfer: dt }),
    ).toBe(false)
  })

  it('keeps a node drop from reaching the window import', () => {
    const { onOuterDrop } = setup(null, true)
    const dt = dragNode('house')
    fireEvent.drop(screen.getByTestId('source-node-bases'), { dataTransfer: dt })
    expect(onOuterDrop).not.toHaveBeenCalled()
  })
})
