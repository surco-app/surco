// The Undo of the notice on screen, handed to ⌘Z. A notice that lives outside the tag undo
// stack (Reviewed) offers its Undo here while it is up, so ⌘Z takes back what the DJ just
// did and reads on screen rather than an older tag edit they are not looking at. Only the
// newest notice counts: it is the one on top.
let offered: (() => void) | null = null

export function offerShortcutUndo(run: () => void): () => void {
  offered = run
  return () => {
    if (offered === run) offered = null
  }
}

export function takeShortcutUndo(): (() => void) | null {
  const run = offered
  offered = null
  return run
}

export function hasShortcutUndo(): boolean {
  return offered !== null
}
