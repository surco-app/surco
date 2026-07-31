// Space is the player's play/pause everywhere in Surco. A section with its own
// transport (click repair's audition) needs the key while it is open — but the
// global binding would ALSO act (the mini-player playing the whole track under
// the repair check, say), which is exactly what must not happen.
//
// So the key is claimed, not re-bound: the open section registers its handler
// here, and the keyboard-shortcut hook consults this before running the global
// command. Module-level (not context) because the claim must survive the
// editor's per-track remount, like the fold/maximize stores next door.
// The silence editor claims its own actions the same way, and for the same reason:
// while the section is open they act on the open track with no focus anywhere, so a
// macro pad drives the trim by pressing a key instead of first clicking a handle.
// One key per side — with no focus to disambiguate, the key IS the side.
type ClaimedKey =
  | 'play'
  | 'trim-start-back'
  | 'trim-start-forward'
  | 'trim-start-audition'
  | 'trim-start-clear'
  | 'trim-end-back'
  | 'trim-end-forward'
  | 'trim-end-audition'
  | 'trim-end-clear'
  | 'trim-apply'

// Shift rides along because it is the coarse step for the trim nudges; `play` ignores it.
export interface ClaimContext {
  shift?: boolean
}

type Handlers = Partial<Record<ClaimedKey, (ctx: ClaimContext) => void>>

const CLAIMABLE: ClaimedKey[] = [
  'play',
  'trim-start-back',
  'trim-start-forward',
  'trim-start-audition',
  'trim-start-clear',
  'trim-end-back',
  'trim-end-forward',
  'trim-end-audition',
  'trim-end-clear',
  'trim-apply',
]

// Whether a command id can be answered by an open section, so the global listener only
// consults the claims for the keys a section could own.
export function isClaimable(id: string): id is ClaimedKey {
  return (CLAIMABLE as string[]).includes(id)
}

// A STACK, not a single claim. Releases can arrive in any order — React unmounts
// children before parents, and the editor's sections are reorderable — so with one
// global slot a release could drop a claim that was still live and let the key fall
// through to the GLOBAL command: Space starting the mini-player underneath a section
// that still had its own transport open, precisely what claiming exists to prevent.
const claims: Handlers[] = []

// Registers the section's handlers and returns the release. A release removes its
// OWN entry wherever it sits, so it can neither resurrect a dead claim nor drop a
// live one.
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
// The key is answered by the NEAREST open section that claims it, not only the top: if
// the top one has nothing to play right now (repair set to Off) the key must not fall
// through to the mini-player while one below is still auditioning — that is the whole
// track blaring under a live transport, the exact thing the claim exists to stop.
export function runKeyClaim(key: ClaimedKey, ctx: ClaimContext = {}): boolean {
  const handler = nearest(key)
  if (!handler) return false
  handler(ctx)
  return true
}

function nearest(key: ClaimedKey): ((ctx: ClaimContext) => void) | undefined {
  for (let i = claims.length - 1; i >= 0; i--) {
    const handler = claims[i][key]
    if (handler) return handler
  }
  return undefined
}
