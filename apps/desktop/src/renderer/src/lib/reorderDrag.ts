// The rows a drag out of the list carries, recorded by the list when the drag starts. That
// drag hands the OS the files (so a row lands in Spek or Finder), and whether the OS then
// also delivers them as files to Surco's own window is not something to build on: the tree
// reads the rows from here instead. Module state, because the list and the tree share no
// component, and a drag is one at a time.
let dragged: { ids: string[]; aliases: Set<string> } | null = null

// The paths are the dragged rows' files. Their other spellings (resolved through the
// symlinked music folder) arrive from main a moment later, long before any drop can.
export function setDraggedRows(ids: string[], paths: string[] = []): void {
  const record = { ids, aliases: new Set(paths.map((p) => p.normalize('NFC'))) }
  dragged = record
  if (paths.length === 0) return
  window.api
    .pathAliases(paths)
    .then((all) => {
      for (const p of all) record.aliases.add(p.normalize('NFC'))
    })
    // Main not answering leaves the plain paths, which the record already holds.
    .catch(() => {})
}

export function draggedRows(): string[] | null {
  return dragged?.ids ?? null
}

export function clearDraggedRows(): void {
  dragged = null
}

// Whether a path is one of the dragged rows' files, in whichever spelling the OS hands it
// back (NFD, or resolved through a symlink).
export function isDraggedPath(path: string): boolean {
  return dragged?.aliases.has(path.normalize('NFC')) ?? false
}

// A drag of the list's rows carries files or nothing. One that brings no files but a link
// or text (from a browser) is another app's drag, even while a stale record is held.
export function carriesOnlyFiles(e: { dataTransfer?: DataTransfer | null }): boolean {
  return Array.from(e.dataTransfer?.types ?? []).every((t) => t === 'Files')
}

// The dragged rows when this drop is that drag coming back down in Surco's window: every
// file it carries is one of theirs. A record left by a drag-out that ended outside the
// window tells this window nothing, so Finder files dropped later are not taken for it.
export function ownRowsDropped(
  e: { dataTransfer?: DataTransfer | null },
  pathOf: (id: string) => string | undefined,
): string[] | null {
  if (!dragged) return null
  const { ids, aliases } = dragged
  const held = new Set([...aliases, ...ids.flatMap((id) => pathOf(id)?.normalize('NFC') ?? [])])
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0 && !carriesOnlyFiles(e)) return null
  return files.every((f) => held.has(window.api.getPathForFile(f).normalize('NFC'))) ? ids : null
}

// A separator dragged to reorder the open playlist. It has no file to hand the OS, so it is
// a plain drag inside the list carrying this type, which the window's import does not
// treat as files arriving and the tree does not take as tracks to add.
export const REORDER_TYPE = 'application/x-surco-reorder'

export function isReorderDrag(e: { dataTransfer?: DataTransfer | null }): boolean {
  return e.dataTransfer?.types?.includes(REORDER_TYPE) ?? false
}
