import { describe, expect, it } from 'vitest'
import { createAnalysisCancelRegistry, isAbortError } from './analysisCancel'

// Browsing away from a track must be able to stop that track's in-flight probes.
// The registry maps each path to the AbortSignals of its cancellable (selection-driven)
// analyses, so one "the user left this row" event aborts them all — while probes for
// other paths, and non-registered (background) work on the same path, keep running.
describe('createAnalysisCancelRegistry', () => {
  it('aborts every signal registered for the cancelled path and no other', async () => {
    const registry = createAnalysisCancelRegistry()
    const seen: string[] = []
    const probe = (path: string, tag: string): Promise<void> =>
      registry.run(path, async (signal) => {
        await new Promise((r) => setTimeout(r, 5))
        if (signal.aborted) return
        seen.push(tag)
      })

    const a1 = probe('/a.wav', 'a-spectrum')
    const a2 = probe('/a.wav', 'a-loudness')
    const b = probe('/b.wav', 'b-spectrum')
    registry.cancel('/a.wav')
    await Promise.all([a1, a2, b])

    expect(seen).toEqual(['b-spectrum'])
  })

  it('forgets a settled job so a later cancel cannot abort a fresh re-run', async () => {
    // Coming back to a track re-runs its probe under a new signal; the old entry must
    // be gone by then or a stale cancel event would kill the analysis the user is
    // actively waiting on.
    const registry = createAnalysisCancelRegistry()
    let firstSignal: AbortSignal | undefined
    await registry.run('/a.wav', async (signal) => {
      firstSignal = signal
    })
    let secondSignal: AbortSignal | undefined
    const second = registry.run('/a.wav', async (signal) => {
      secondSignal = signal
      await new Promise((r) => setTimeout(r, 5))
    })
    registry.cancel('/a.wav')
    await second

    expect(firstSignal?.aborted).toBe(false)
    expect(secondSignal?.aborted).toBe(true)
  })

  it('propagates the job result and its failure', async () => {
    const registry = createAnalysisCancelRegistry()
    await expect(registry.run('/a.wav', async () => 42)).resolves.toBe(42)
    await expect(
      registry.run('/a.wav', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
  })
})

describe('isAbortError', () => {
  it('recognizes the shapes an aborted execFile and the limiter produce', () => {
    // execFile rejects with code ABORT_ERR / name AbortError; the limiter throws a
    // plain Error named AbortError. Both are the silent "user browsed away" outcome —
    // neither may be logged as a real analysis failure.
    const nodeStyle = Object.assign(new Error('The operation was aborted'), {
      code: 'ABORT_ERR',
    })
    const limiterStyle = Object.assign(new Error('analysis aborted'), { name: 'AbortError' })
    expect(isAbortError(nodeStyle)).toBe(true)
    expect(isAbortError(limiterStyle)).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(null)).toBe(false)
  })
})
