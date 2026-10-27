// A field holds what is typed for a short pause before committing it to the track. Anything
// that acts on the track meanwhile (⌘⏎ converting it, the selection moving off it) would
// read the old value, so it first asks every field with text in flight to commit now.
// Module-level for the same reason as the key claims: the fields live deep in the editor
// and the callers are the global command registry and the selection.
const pending = new Set<() => void>()

export function holdPendingEdit(flush: () => void): () => void {
  pending.add(flush)
  return () => pending.delete(flush)
}

export function flushPendingEdits(): void {
  for (const flush of [...pending]) flush()
}
