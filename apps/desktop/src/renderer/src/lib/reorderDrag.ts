// The rows a drag out of the list carries, recorded by the list when the drag starts. That
// drag hands the OS the files (so a row lands in Spek or Finder), and whether the OS then
// also delivers them as files to Surco's own window is not something to build on: the tree
// reads the rows from here instead. Module state, because the list and the tree share no
// component, and a drag is one at a time.
let draggedRowIds: string[] | null = null

export function setDraggedRows(ids: string[]): void {
  draggedRowIds = ids
}

export function draggedRows(): string[] | null {
  return draggedRowIds
}

export function clearDraggedRows(): void {
  draggedRowIds = null
}
