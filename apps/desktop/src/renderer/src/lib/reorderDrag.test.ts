import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDraggedRows,
  draggedRows,
  isReorderDrag,
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
