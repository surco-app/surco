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

// The dragged rows when this drop is that drag coming back down in Surco's window: every
// file it carries is one of theirs. A record left by a drag-out that ended outside the
// window tells this window nothing, so Finder files dropped later are not taken for it.
export function ownRowsDropped(
  e: { dataTransfer?: DataTransfer | null },
  pathOf: (id: string) => string | undefined,
): string[] | null {
  const ids = draggedRowIds
  if (!ids) return null
  const held = new Set(ids.flatMap((id) => pathOf(id)?.normalize('NFC') ?? []))
  const files = Array.from(e.dataTransfer?.files ?? [])
  return files.every((f) => held.has(window.api.getPathForFile(f).normalize('NFC'))) ? ids : null
}

// A separator dragged to reorder the open playlist. It has no file to hand the OS, so it is
// a plain drag inside the list carrying this type, which the window's import does not
// treat as files arriving and the tree does not take as tracks to add.
export const REORDER_TYPE = 'application/x-surco-reorder'

export function isReorderDrag(e: { dataTransfer?: DataTransfer | null }): boolean {
  return e.dataTransfer?.types?.includes(REORDER_TYPE) ?? false
}
