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
export type ClaimedKey = 'play' | 'centre-beat' | 'add-segment'

type Handlers = Partial<Record<ClaimedKey, () => void>>

let claim: Handlers | null = null

// Registers the section's handlers and returns the release. The last claimant
// wins: only one section can own the lane at a time, and a stale claim can never
// outlive its section (the effect releases on unmount and on close).
export function claimKeys(handlers: Handlers): () => void {
  claim = handlers
  return () => {
    if (claim === handlers) claim = null
  }
}

// True when a section handled the key — the caller must then leave the global
// command alone.
export function runKeyClaim(key: ClaimedKey): boolean {
  const handler = claim?.[key]
  if (!handler) return false
  handler()
  return true
}
