// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraggedRows,
  draggedRows,
  isReorderDrag,
  ownRowsDropped,
  REORDER_TYPE,
  setDraggedRows,
} from './reorderDrag'

afterEach(clearDraggedRows)

describe('dragged rows', () => {
  // The tree learns what the list is dragging from here, not from the files the OS drag
  // may or may not bring back into Surco's own window.
  it('holds the rows of the drag in progress until it is cleared', () => {
    expect(draggedRows()).toBeNull()
    setDraggedRows(['a', 'b'])
    expect(draggedRows()).toEqual(['a', 'b'])
    clearDraggedRows()
    expect(draggedRows()).toBeNull()
  })
})

describe('isReorderDrag', () => {
  // The window's import and the tree tell a reorder inside the list from files arriving by
  // this type alone; a Finder drop must never read as a reorder, nor a reorder as files.
  it('tells a reorder drag from a drag of files', () => {
    const drag = (types: string[]) => ({ dataTransfer: { types } as unknown as DataTransfer })
    expect(isReorderDrag(drag([REORDER_TYPE]))).toBe(true)
    expect(isReorderDrag(drag(['Files']))).toBe(false)
    expect(isReorderDrag({})).toBe(false)
  })
})

describe('ownRowsDropped', () => {
  const PATHS: Record<string, string> = {
    a: '/Users/v/Music/Music/Café.wav',
    b: '/Users/v/Music/Music/b.wav',
  }
  const file = (path: string) => ({ path }) as unknown as File
  const drop = (paths: string[], types = ['Files']) => ({
    dataTransfer: { files: paths.map(file), types } as unknown as DataTransfer,
  })
  const pathOf = (id: string) => PATHS[id]
  beforeEach(() => {
    ;(window as unknown as { api: unknown }).api = {
      getPathForFile: (f: { path: string }) => f.path,
      pathAliases: vi.fn(async (paths: string[]) =>
        paths.flatMap((p) => [p, p.replace('/Users/v/Music/Music', '/Volumes/Public/Music')]),
      ),
    }
  })
  const settle = () => new Promise((r) => setTimeout(r, 0))

  // macOS hands paths back decomposed: the same file in NFD is still the dragged row, or
  // the drop would import it and jump the rail to Tracks.
  it('takes a decomposed spelling of a dragged file as that row', async () => {
    setDraggedRows(['a'], [PATHS.a])
    await settle()
    expect(ownRowsDropped(drop([PATHS.a.normalize('NFD')]), pathOf)).toEqual(['a'])
  })

  // The OS may report the symlinked music folder resolved to the volume it points at.
  it('takes the resolved spelling of a row under a symlinked folder as that row', async () => {
    setDraggedRows(['a', 'b'], [PATHS.a, PATHS.b])
    await settle()
    expect(
      ownRowsDropped(
        drop(['/Volumes/Public/Music/Café.wav', '/Volumes/Public/Music/b.wav']),
        pathOf,
      ),
    ).toEqual(['a', 'b'])
  })

  it('does not take a file the drag did not carry as one of its rows', async () => {
    setDraggedRows(['a'], [PATHS.a])
    await settle()
    expect(ownRowsDropped(drop([PATHS.a, '/elsewhere/x.wav']), pathOf)).toBeNull()
  })
})
