// Space is the player's play/pause everywhere in Surco. A section with its own
// transport (the beatgrid's audition) needs it while it's open, but the global
// binding would ALSO start the mini-player on the same press — two things
// playing at once, which is exactly what a grid check must not have.
//
// So the key is claimed, not re-bound: the open section registers a handler
// here, and the keyboard-shortcut hook consults this before running the play
// command. Module-level (not context) because the claim must survive the
// editor's per-track remount, like the fold/maximize stores next door.
type Handler = () => void

let claim: Handler | null = null

// Registers this section's Space handler and returns the release. The last
// claimant wins: only one section can be open-and-focused on the grid at a time,
// and a stale claim can never outlive its section (the effect releases on
// unmount and on close).
export function claimSpace(handler: Handler): () => void {
  claim = handler
  return () => {
    if (claim === handler) claim = null
  }
}

// True when a section handled the press — the caller must then leave the global
// play command alone.
export function runSpaceClaim(): boolean {
  if (!claim) return false
  claim()
  return true
}
