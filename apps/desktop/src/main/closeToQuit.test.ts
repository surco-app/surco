import { describe, expect, it, vi } from 'vitest'
import { createQuitIntent, handleGuardedClose } from './closeToQuit'
import type { QuitGuard } from './quitGuard'

function guard(answer: boolean): QuitGuard {
  let confirmed = false
  return {
    mustAsk: () => !confirmed,
    ask: vi.fn(async () => {
      if (answer) confirmed = true
      return answer
    }),
  }
}

const flush = () => new Promise((r) => setImmediate(r))

function deps(g: QuitGuard) {
  return { guard: g, intent: createQuitIntent(), killAll: vi.fn(), close: vi.fn() }
}

// The close is prevented while the dialog is up, and a prevented close cancels the app.quit()
// that raised it. On macOS closing the window alone never quits, so a confirmed ⌘Q during a
// conversion left Surco running with no window: the quit has to be started again.
describe('handleGuardedClose', () => {
  it('resumes the quit that raised the close once the user confirms', async () => {
    const d = deps(guard(true))
    const resume = vi.fn()
    d.intent.started(resume)
    const event = { preventDefault: vi.fn() }

    handleGuardedClose(event, d)
    await flush()

    expect(event.preventDefault).toHaveBeenCalled()
    expect(d.killAll).toHaveBeenCalled()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(d.close).not.toHaveBeenCalled()
  })

  // Clicking the window's X is not a quit: on macOS the app stays in the Dock as before.
  it('only closes the window when no quit was in progress', async () => {
    const d = deps(guard(true))
    handleGuardedClose({ preventDefault: vi.fn() }, d)
    await flush()
    expect(d.close).toHaveBeenCalledTimes(1)
  })

  // A declined ⌘Q must not linger: a later click on the X would otherwise quit the whole app.
  it('forgets a declined quit', async () => {
    const declining = deps(guard(false))
    const resume = vi.fn()
    declining.intent.started(resume)
    handleGuardedClose({ preventDefault: vi.fn() }, declining)
    await flush()
    expect(resume).not.toHaveBeenCalled()

    const accepting = { ...declining, guard: guard(true) }
    handleGuardedClose({ preventDefault: vi.fn() }, accepting)
    await flush()
    expect(resume).not.toHaveBeenCalled()
    expect(accepting.close).toHaveBeenCalledTimes(1)
  })

  it('lets a quiet close through untouched', () => {
    const d = deps({ mustAsk: () => false, ask: vi.fn() })
    const event = { preventDefault: vi.fn() }
    handleGuardedClose(event, d)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(d.guard.ask).not.toHaveBeenCalled()
  })
})
