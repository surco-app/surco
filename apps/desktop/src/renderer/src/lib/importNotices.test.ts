import { describe, expect, it } from 'vitest'
import { createAppStore } from './appStore'
import { pushImportNotice } from './importNotices'

// A folder walk streams one batch per DIRECTORY, and each batch closes its own counter
// cycle — so a crate on a network share (hundreds of folders, some unreadable) raised a
// separate card per folder and buried the UI under a wall of toasts while the import ran.
// The notices collapse onto one card per kind instead.
describe('pushImportNotice', () => {
  it('replaces the previous card instead of stacking one per batch', () => {
    const store = createAppStore()
    pushImportNotice(store, 'meta-read-failed', 'could not read 1 file')
    pushImportNotice(store, 'meta-read-failed', 'could not read 2 files')
    pushImportNotice(store, 'meta-read-failed', 'could not read 3 files')
    const { toasts } = store.getState()
    expect(toasts).toHaveLength(1)
    expect(toasts[0].message).toBe('could not read 3 files')
  })

  // The two import notices report different things, so one must not swallow the other:
  // a drop that both skips duplicates and fails a read has to show both.
  it('keeps the duplicate and unreadable notices on separate cards', () => {
    const store = createAppStore()
    pushImportNotice(store, 'meta-read-failed', 'could not read 2 files')
    pushImportNotice(store, 'duplicates-skipped', 'already in the list: 4')
    expect(store.getState().toasts).toHaveLength(2)
  })

  // Import notices are informational and must age out on their own; a card that waits for
  // a click would leave the user dismissing toasts after every network import.
  it('auto-dismisses rather than waiting for a click', () => {
    const store = createAppStore()
    pushImportNotice(store, 'meta-read-failed', 'could not read 1 file')
    expect(store.getState().toasts[0].duration).toBeGreaterThan(0)
  })
})
