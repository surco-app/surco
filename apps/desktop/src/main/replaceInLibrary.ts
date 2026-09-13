// Swaps a library copy for the file that supersedes it.
//
// Apple Music exposes a track's location for reading but never for writing, so there is no
// way to point an existing entry at a different file: a replacement is an add followed by
// a delete. What this module decides is the order, and what to do when half of it fails.

// Only what a replacement needs: the two fields the delete verifies the live entry
// against. Narrower than the editor's full metadata on purpose — this decides an order,
// not what gets written into the library.
export interface ReplaceMeta {
  artist: string
  title: string
}

export interface ReplaceLibraryCopyDeps {
  add: (path: string, meta: ReplaceMeta) => Promise<string>
  // Verifies the live entry still carries the label before deleting, so a stale snapshot
  // cannot delete the wrong track.
  remove: (persistentId: string, expectedLabel: string) => Promise<unknown>
}

export async function replaceLibraryCopy(
  input: { newPath: string; oldPersistentId: string; meta: ReplaceMeta },
  deps: ReplaceLibraryCopyDeps,
): Promise<string> {
  // Add first. The reverse order loses the track outright if the add then fails — the old
  // copy already deleted, the new one never created. This way the worst case is two
  // copies: visible, and something the user can undo.
  const persistentId = await deps.add(input.newPath, input.meta)

  try {
    await deps.remove(input.oldPersistentId, `${input.meta.artist} - ${input.meta.title}`)
  } catch {
    // The new copy is in the library and the user has what they asked for. Rolling it back
    // to tidy up a leftover entry would trade the thing that worked for the thing that
    // did not; the stale copy stays and can be removed by hand.
  }

  return persistentId
}
