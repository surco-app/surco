// Space is the player's play/pause everywhere in Surco, and plain letters run
// list commands. A section with its own transport and its own lane (the
// beatgrid: audition + "centre the nearest beat", rekordbox's C) needs those
// keys while it is open — but the global bindings would ALSO act (the
// mini-player playing the whole track under the grid check, say), which is
// exactly what must not happen.
//
// So the keys are claimed, not re-bound: the open section registers its
// handlers here, and the keyboard-shortcut hook consults this before running
// the global command. Module-level (not context) because the claim must survive
// the editor's per-track remount, like the fold/maximize stores next door.
export type ClaimedKey =
  | 'play'
  | 'centre-beat'
  | 'add-segment'
  | 'prev-segment'
  | 'next-segment'

type Handlers = Partial<Record<ClaimedKey, () => void>>

// A STACK, not a single claim. Two wave sections can be open at once (click repair and
// the beatgrid), and each has its own transport. With one global slot the second to
// register silently overwrote the first — and when that one released, the key fell
// through to the GLOBAL command, so Space started the mini-player underneath a section
// that still had its own transport open. That is precisely what claiming exists to
// prevent, and it was invisible until a second section ever claimed the same key.
//
// The top of the stack owns the keys (the section opened last is the one being looked
// at); releasing it restores the one below rather than freeing the key.
const claims: Handlers[] = []

// Registers the section's handlers and returns the release. Releases can arrive in any
// order — React unmounts children before parents, and the editor's sections are
// reorderable — so a release removes its OWN entry wherever it sits, and can neither
// resurrect a dead claim nor drop a live one.
export function claimKeys(handlers: Handlers): () => void {
  claims.push(handlers)
  return () => {
    const i = claims.indexOf(handlers)
    if (i !== -1) claims.splice(i, 1)
  }
}

// True when a section handled the key — the caller must then leave the global command
// alone. Only the top claimant answers: a section that owns the lane owns it whole, so a
// key it did not register does not fall through to the section underneath (which the user
// is not looking at) — it goes to the global command, as if nothing were claimed.
export function runKeyClaim(key: ClaimedKey): boolean {
  const handler = claims.at(-1)?.[key]
  if (!handler) return false
  handler()
  return true
}
