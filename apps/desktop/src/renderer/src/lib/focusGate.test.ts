import { describe, expect, it } from 'vitest'
import { createFocusGate } from './focusGate'

describe('createFocusGate', () => {
  // Focused is the steady state: gating background work must be free (resolve now)
  // so a focused app behaves exactly as it did before the gate existed.
  it('resolves wait() immediately while focused', async () => {
    const gate = createFocusGate(true)
    let resolved = false
    gate.wait().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  // The whole point: while the window is in the background, a worker that awaits the
  // gate parks instead of spawning ffmpeg — and only un-parks when focus returns.
  it('parks wait() while blurred and resolves it when focus returns', async () => {
    const gate = createFocusGate(true)
    gate.set(false)
    let resolved = false
    gate.wait().then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    gate.set(true)
    await Promise.resolve()
    expect(resolved).toBe(true)
  })

  // A capped sweep parks several workers at once; one focus event must release all.
  it('releases every parked waiter on focus', async () => {
    const gate = createFocusGate(false)
    const done = [false, false, false]
    done.forEach((_, i) => {
      gate.wait().then(() => (done[i] = true))
    })
    await Promise.resolve()
    expect(done).toEqual([false, false, false])

    gate.set(true)
    await Promise.resolve()
    expect(done).toEqual([true, true, true])
  })

  // Repeated focus events (macOS fires focus without an intervening blur) must not
  // throw or double-resolve.
  it('is idempotent when already focused', async () => {
    const gate = createFocusGate(true)
    expect(() => gate.set(true)).not.toThrow()
    await expect(gate.wait()).resolves.toBeUndefined()
  })
})
