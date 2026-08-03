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
    expect(confirm).toHaveBeenCalledWith(3)
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
