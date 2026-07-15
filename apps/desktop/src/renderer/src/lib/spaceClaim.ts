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
// alone.
//
// Play is answered by the NEAREST open section that claims it, not only the top. Two
// sections with a transport can be open at once (click repair and the beatgrid); if the
// top one has nothing to play right now (repair set to Off) the key must not fall through
// to the mini-player while the one below is still auditioning — that is the whole track
// blaring under a live transport, the exact thing the claim exists to stop.
//
// The lane verbs (centre-beat, add-segment, prev/next-segment) stay top-only: they act on
// the section the user is looking at, so a key the top did not register is simply not that
// section's verb and must not reach into the one underneath.
export function runKeyClaim(key: ClaimedKey): boolean {
  const handler = key === 'play' ? nearestPlay() : claims.at(-1)?.[key]
  if (!handler) return false
  handler()
  return true
}

function nearestPlay(): (() => void) | undefined {
  for (let i = claims.length - 1; i >= 0; i--) {
    const handler = claims[i].play
    if (handler) return handler
  }
  return undefined
}
