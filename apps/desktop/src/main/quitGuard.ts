interface QuitGuardDeps {
  // How many conversions are running right now.
  count: () => number
  // Ask the user whether to quit anyway; resolves true to go ahead.
  confirm: (running: number) => Promise<boolean>
}

export interface QuitGuard {
  // Whether this close has to stop and ask. False once nothing is converting, or once
  // the user has already agreed to quit, so the re-close falls straight through.
  mustAsk: () => boolean
  // Raise the question (at most one dialog at a time); resolves true to close now.
  ask: () => Promise<boolean>
}

// Closing mid-batch killed the running conversions and dropped everything still queued
// without a word, so the DJ came back to a half-converted crate with no sign of where it
// stopped. This decides whether a close stops to ask first; the window wiring stays in
// index.ts, and the decision is testable on its own.
export function createQuitGuard(deps: QuitGuardDeps): QuitGuard {
  let confirmed = false
  // ⌘Q can land on the window while the X's dialog is already up. Sharing the one
  // promise keeps that from stacking a second dialog over the first.
  let asking: Promise<boolean> | null = null
  return {
    mustAsk: () => !confirmed && deps.count() > 0,
    async ask() {
      asking ??= deps.confirm(deps.count()).finally(() => {
        asking = null
      })
      const quit = await asking
      if (quit) confirmed = true
      return quit
    },
  }
}
