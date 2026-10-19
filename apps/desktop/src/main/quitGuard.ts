interface QuitGuardDeps {
  // How many conversions are running right now.
  count: () => number
  // Whether a USB export is running right now.
  exporting?: () => boolean
  // Ask the user whether to quit anyway; resolves true to go ahead.
  confirm: (running: number, exporting: boolean) => Promise<boolean>
  // Once the user agreed: stop the USB export and resolve when it has reported.
  settle?: () => Promise<void>
  // How long the close waits for settle before going ahead anyway.
  settleMs?: number
  writing?: () => boolean
  finishWriting?: () => Promise<void>
}

export interface QuitGuard {
  // Whether this close has to stop and ask. False once nothing is converting or exporting,
  // or once the user has already agreed to quit, so the re-close falls straight through.
  mustAsk: () => boolean
  // Raise the question (at most one dialog at a time); resolves true to close now.
  ask: () => Promise<boolean>
}

// Long enough for the track being copied and the databases on a slow stick; short enough
// that a baken that never reports cannot keep the app from quitting.
const SETTLE_MS = 60_000

// Closing mid-batch killed the running conversions and dropped everything still queued
// without a word, so the DJ came back to a half-converted crate with no sign of where it
// stopped. This decides whether a close stops to ask first; the window wiring stays in
// index.ts, and the decision is testable on its own.
// A USB export is asked about too: quitting under it left baken writing the stick with no
// .sync files and no memory, so a confirmed quit first stops it and waits for its report.
export function createQuitGuard(deps: QuitGuardDeps): QuitGuard {
  let confirmed = false
  const exporting = (): boolean => deps.exporting?.() ?? false
  // ⌘Q can land on the window while the X's dialog is already up. Sharing the one
  // promise keeps that from stacking a second dialog over the first.
  let asking: Promise<boolean> | null = null
  const writing = (): boolean => deps.writing?.() ?? false
  const within = async (work: (() => Promise<void>) | undefined): Promise<void> => {
    if (!work) return
    let timer: NodeJS.Timeout | undefined
    const timeout = new Promise<void>((r) => {
      timer = setTimeout(r, deps.settleMs ?? SETTLE_MS)
    })
    await Promise.race([work(), timeout])
    clearTimeout(timer)
  }
  const settle = async (): Promise<void> => {
    await within(deps.settle)
    if (writing()) await within(deps.finishWriting)
  }
  return {
    mustAsk: () => !confirmed && (deps.count() > 0 || exporting() || writing()),
    async ask() {
      const quiet = deps.count() === 0 && !exporting()
      asking ??= (quiet ? Promise.resolve(true) : deps.confirm(deps.count(), exporting()))
        .then(async (quit) => {
          if (quit) await settle()
          return quit
        })
        .finally(() => {
          asking = null
        })
      const quit = await asking
      if (quit) confirmed = true
      return quit
    },
  }
}
