export interface FocusGate {
  // Fed by the main process's window blur/focus events.
  set(focused: boolean): void
  // Resolves now if focused, otherwise parks until focus returns. A background
  // sweep awaits this before each ffmpeg pass so it idles while the app is hidden.
  wait(): Promise<void>
}

// A latch that lets long-running renderer work pause while the window is in the
// background and resume when it comes forward, without polling: blurred waiters
// hold a parked promise that focus resolves in one shot.
export function createFocusGate(focused = true): FocusGate {
  let isFocused = focused
  let waiters: Array<() => void> = []
  return {
    set(next: boolean): void {
      isFocused = next
      if (next && waiters.length > 0) {
        const pending = waiters
        waiters = []
        for (const resolve of pending) resolve()
      }
    },
    wait(): Promise<void> {
      if (isFocused) return Promise.resolve()
      return new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}
