import type { QuitGuard } from './quitGuard'

export interface QuitIntent {
  // A quit began (before-quit, or an update's before-quit-for-update); `resume` starts it again.
  started: (resume: () => void) => void
  // The quit in progress, if any, cleared so a declined one never lingers.
  take: () => (() => void) | null
}

export function createQuitIntent(): QuitIntent {
  let resume: (() => void) | null = null
  return {
    started(fn) {
      resume = fn
    },
    take() {
      const pending = resume
      resume = null
      return pending
    },
  }
}

interface CloseDeps {
  guard: QuitGuard
  intent: QuitIntent
  killAll: () => void
  close: () => void
}

// The decision is async and 'close' is not, so the event is always prevented first and the
// window closed again once the user has answered. Preventing it also cancels an app.quit()
// that raised it, and on macOS closing the window alone never quits, so a confirmed ⌘Q left
// Surco running with no window: a quit in progress is started again instead.
export function handleGuardedClose(event: { preventDefault: () => void }, deps: CloseDeps): void {
  if (!deps.guard.mustAsk()) return
  event.preventDefault()
  const resume = deps.intent.take()
  deps.guard.ask().then((quit) => {
    if (quit) {
      deps.killAll()
      if (resume) resume()
      else deps.close()
    }
  })
}
