import { afterEach, describe, expect, it } from 'vitest'
import { clearDraggedRows, draggedRows, setDraggedRows } from './reorderDrag'

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
