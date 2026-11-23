import { afterEach, describe, expect, it } from 'vitest'
import { hasShortcutUndo, offerShortcutUndo, takeShortcutUndo } from './shortcutUndo'

afterEach(() => {
  takeShortcutUndo()
})

describe('shortcutUndo', () => {
  // ⌘Z is the DJ's reflex for "take back what I just did". While a notice with Undo is on
  // screen, that is the thing they just did, and pressing ⌘Z twice must not undo it twice.
  it('hands ⌘Z the undo of the notice on screen, once', () => {
    const undo = () => {}
    offerShortcutUndo(undo)
    expect(takeShortcutUndo()).toBe(undo)
    expect(takeShortcutUndo()).toBeNull()
  })

  // Once the notice is gone the DJ can no longer see what ⌘Z would take back, so it must
  // fall back to undoing tag edits as it always did.
  it('forgets the offer when its notice goes, so ⌘Z returns to tag undo', () => {
    const withdraw = offerShortcutUndo(() => {})
    expect(hasShortcutUndo()).toBe(true)
    withdraw()
    expect(hasShortcutUndo()).toBe(false)
    expect(takeShortcutUndo()).toBeNull()
  })

  // Two Reviewed in a row: ⌘Z takes back the last one, the one whose notice is on top.
  // Withdrawing the older one later must not cancel the newer offer.
  it('lets a newer notice replace the older offer', () => {
    const older = () => {}
    const newer = () => {}
    const withdrawOlder = offerShortcutUndo(older)
    offerShortcutUndo(newer)
    withdrawOlder()
    expect(takeShortcutUndo()).toBe(newer)
  })
})
