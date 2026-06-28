import type { AppStore } from './appStore'

// One entry in the unified notification queue. Tone drives the colour (neutral status vs a
// red failure); an optional action turns the card into a prompt (Restart / Load); duration
// auto-dismisses transient notices, while a missing duration keeps prompts and failures up
// until the user acts. key collapses re-raises of the same logical toast onto one card, and
// testid preserves the per-toast selectors the suite already asserts on.
export interface Toast {
  id: string
  key?: string
  tone: 'neutral' | 'danger'
  message: string
  action?: { label: string; onAction: () => void }
  duration?: number
  testid?: string
  // Extra cleanup to run when this toast is dismissed (by the ✕, its timer, or an action),
  // beyond removing the card — e.g. clearing the pending-new-tracks set so its count resets.
  onDismiss?: () => void
}

let counter = 0

// crypto.randomUUID would do, but a monotonic counter keeps ids deterministic across a test
// run and is enough — ids only need to be unique within one mounted queue.
function nextId(): string {
  counter += 1
  return `toast-${counter}`
}

// Append a toast, or replace the one sharing its key so a re-raise (a fresh "N new tracks"
// for the same folder, a re-downloaded update) updates in place rather than stacking a
// duplicate. Returns the new toast's id so the caller can dismiss exactly what it raised.
export function pushToast(store: AppStore, toast: Omit<Toast, 'id'>): string {
  const id = nextId()
  const next: Toast = { ...toast, id }
  store.setState({
    toasts: toast.key
      ? [...store.getState().toasts.filter((t) => t.key !== toast.key), next]
      : [...store.getState().toasts, next],
  })
  return id
}

// Remove a toast from the stack. This is the bookkeeping removal used by timers and effect
// cleanup; the user-driven ✕ goes through dismissToastByUser so a toast's own onDismiss only
// fires when the user actually closes it, never when the card is replaced or aged out.
export function dismissToast(store: AppStore, id: string): void {
  store.setState({ toasts: store.getState().toasts.filter((t) => t.id !== id) })
}

// The ✕ button: remove the card and run its onDismiss (e.g. clear the pending-new set so its
// count resets). Kept distinct from dismissToast so replacing or auto-expiring a toast does
// not trip side effects meant only for an explicit close.
export function dismissToastByUser(store: AppStore, id: string): void {
  const toast = store.getState().toasts.find((t) => t.id === id)
  dismissToast(store, id)
  toast?.onDismiss?.()
}
