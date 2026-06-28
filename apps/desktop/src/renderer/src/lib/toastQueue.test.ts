import { describe, expect, it, vi } from 'vitest'
import { createAppStore } from './appStore'
import { dismissToast, dismissToastByUser, pushToast } from './toastQueue'

describe('toast queue', () => {
  it('appends pushed toasts in order so several can stack at once', () => {
    // The whole point of unifying the toasts is that a notice and an action prompt can
    // coexist instead of one corner clobbering the other.
    const store = createAppStore()
    pushToast(store, { tone: 'neutral', message: 'first' })
    pushToast(store, { tone: 'danger', message: 'second' })
    expect(store.getState().toasts.map((t) => t.message)).toEqual(['first', 'second'])
  })

  it('returns the new toast id so a caller can dismiss exactly the one it raised', () => {
    const store = createAppStore()
    const id = pushToast(store, { tone: 'neutral', message: 'x' })
    expect(store.getState().toasts.find((t) => t.id === id)?.message).toBe('x')
  })

  it('dismiss removes only the matching toast, leaving the rest of the stack', () => {
    const store = createAppStore()
    const a = pushToast(store, { tone: 'neutral', message: 'a' })
    pushToast(store, { tone: 'neutral', message: 'b' })
    dismissToast(store, a)
    expect(store.getState().toasts.map((t) => t.message)).toEqual(['b'])
  })

  it('replaces an existing toast that shares a key instead of stacking a duplicate', () => {
    // Re-raising the same logical toast (e.g. a fresh "N new tracks" for the same folder, or
    // a re-downloaded update) must update in place, not pile identical cards on screen.
    const store = createAppStore()
    pushToast(store, { key: 'update', tone: 'neutral', message: 'v1 ready' })
    pushToast(store, { key: 'update', tone: 'neutral', message: 'v2 ready' })
    const updates = store.getState().toasts.filter((t) => t.key === 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].message).toBe('v2 ready')
  })

  it('runs onDismiss only when the user closes a toast, never on a bare removal', () => {
    // A toast's onDismiss has side effects (clearing the pending-new set). The ✕ must fire
    // it; a timer expiry or a keyed-replacement removal must not, or the side effect trips
    // every time the card is refreshed.
    const store = createAppStore()
    const onDismiss = vi.fn()
    const id = pushToast(store, { tone: 'neutral', message: 'x', onDismiss })

    dismissToast(store, id)
    expect(onDismiss).not.toHaveBeenCalled()

    const id2 = pushToast(store, { tone: 'neutral', message: 'y', onDismiss })
    dismissToastByUser(store, id2)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
