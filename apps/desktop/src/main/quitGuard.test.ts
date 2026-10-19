import { describe, expect, it, vi } from 'vitest'
import { createQuitGuard } from './quitGuard'

// Closing mid-batch used to kill the running conversions and silently drop everything
// still queued: the DJ came back to a half-converted crate with no sign of where it
// stopped. The guard decides whether a close stops to ask first.
describe('createQuitGuard', () => {
  // A quiet app must close on the first click — never raise a dialog to say "nothing is
  // running", which is the kind of prompt that trains people to dismiss on reflex.
  it('does not ask when nothing is converting', () => {
    const confirm = vi.fn()
    const guard = createQuitGuard({ count: () => 0, confirm })
    expect(guard.mustAsk()).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks while a conversion is running, and reports how many', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const guard = createQuitGuard({ count: () => 3, confirm })
    expect(guard.mustAsk()).toBe(true)
    expect(await guard.ask()).toBe(false)
    expect(confirm).toHaveBeenCalledWith(3, false)
  })

  // A USB export runs in main: quitting without asking left baken writing the stick with
  // no app, no .sync files and no memory of the export.
  it('asks while a USB export runs, even with nothing converting', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const guard = createQuitGuard({ count: () => 0, exporting: () => true, confirm })
    expect(guard.mustAsk()).toBe(true)
    expect(await guard.ask()).toBe(false)
    expect(confirm).toHaveBeenCalledWith(0, true)
  })

  // The window closes only once the export has stopped and reported, so its last writes
  // land before the process goes.
  it('waits for the export to settle before letting the close through', async () => {
    let settled = false
    let finish: () => void = () => {}
    const settle = vi.fn(
      () =>
        new Promise<void>((r) => {
          finish = () => {
            settled = true
            r()
          }
        }),
    )
    const guard = createQuitGuard({
      count: () => 0,
      exporting: () => true,
      confirm: async () => true,
      settle,
    })
    const quitting = guard.ask()
    await new Promise((r) => setTimeout(r, 5))
    expect(settle).toHaveBeenCalledTimes(1)
    finish()
    expect(await quitting).toBe(true)
    expect(settled).toBe(true)
  })

  // A baken that never reports must not make the app impossible to quit.
  it('gives up waiting after settleMs', async () => {
    vi.useFakeTimers()
    try {
      const guard = createQuitGuard({
        count: () => 0,
        exporting: () => true,
        confirm: async () => true,
        settle: () => new Promise<void>(() => {}),
        settleMs: 1000,
      })
      const quitting = guard.ask()
      await vi.advanceTimersByTimeAsync(1000)
      expect(await quitting).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  // Declining must not touch the export.
  it('does not stop the export when the user stays', async () => {
    const settle = vi.fn(async () => {})
    const guard = createQuitGuard({
      count: () => 0,
      exporting: () => true,
      confirm: async () => false,
      settle,
    })
    expect(await guard.ask()).toBe(false)
    expect(settle).not.toHaveBeenCalled()
  })

  // Declining leaves the window open AND the guard armed: a second close has to ask
  // again, or "keep converting" would quietly become "quit next time".
  it('stays armed after the user declines', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    const guard = createQuitGuard({ count: () => 1, confirm })
    expect(await guard.ask()).toBe(false)
    expect(guard.mustAsk()).toBe(true)
    expect(await guard.ask()).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  // The close that raised the dialog was already prevented, so accepting can't un-prevent
  // it: the caller closes again, and that second close must fall straight through or the
  // window becomes impossible to close while ffmpeg is alive.
  it('lets the re-close through once the user confirms', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    const guard = createQuitGuard({ count: () => 1, confirm })
    expect(await guard.ask()).toBe(true)
    expect(guard.mustAsk()).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  // ⌘Q landing on the window while the X's dialog is already up must share that one
  // prompt rather than stacking a second dialog on top of it.
  it('raises a single dialog when close fires twice before the answer', async () => {
    let settle: (ok: boolean) => void = () => {}
    const confirm = vi.fn(() => new Promise<boolean>((r) => (settle = r)))
    const guard = createQuitGuard({ count: () => 1, confirm })
    const first = guard.ask()
    const second = guard.ask()
    settle(false)
    expect(await first).toBe(false)
    expect(await second).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
  })
})
