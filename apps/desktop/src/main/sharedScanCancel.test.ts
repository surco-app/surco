import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('./settings', () => ({ getSettings: () => ({ traktorNmlPath: '' }) }))

import { createSharedScan } from './sharedScan'

// Selecting a track fires audio:waveform and audio:waveform-scan together, and they now
// share one native decode. That sharing is what makes cancellation subtle: each probe
// aborts independently when its own React Query observer goes away, so honouring the
// first abort would strand the probe still waiting — while honouring none would undo the
// cancellation that keeps a browsed-past track from holding limiter slots. The decode
// must outlive every consumer but the last.
describe('shared scan cancellation', () => {
  const scanOf = (kill: () => void) => {
    let settle: (v: { ok: true }) => void
    const promise = new Promise<{ ok: true }>((res) => {
      settle = res
    })
    return {
      run: () => promise,
      kill,
      finish: () => settle({ ok: true }),
    }
  }

  it('keeps decoding while another consumer is still waiting', async () => {
    // The player's wave is 'urgent' and the strip's scan is not, so one routinely loses
    // its observer while the other is still on screen. Killing the decode on that first
    // abort would leave the surviving probe waiting on a child that no longer exists.
    let killed = false
    const stub = scanOf(() => {
      killed = true
    })
    const shared = createSharedScan(stub.run, stub.kill)
    const a = new AbortController()
    const b = new AbortController()
    const first = shared('/t.flac', a.signal).catch(() => 'aborted')
    const second = shared('/t.flac', b.signal)
    a.abort()
    expect(await first).toBe('aborted')
    expect(killed).toBe(false)
    stub.finish()
    expect(await second).toEqual({ ok: true })
  })

  it('kills the decode once the last consumer has gone', async () => {
    // The whole point of audio:cancelAnalysis: a track browsed past must stop burning a
    // core, or the newly selected row queues behind ghosts.
    let killed = false
    const stub = scanOf(() => {
      killed = true
    })
    const shared = createSharedScan(stub.run, stub.kill)
    const a = new AbortController()
    const b = new AbortController()
    const first = shared('/t.flac', a.signal).catch(() => 'aborted')
    const second = shared('/t.flac', b.signal).catch(() => 'aborted')
    a.abort()
    b.abort()
    expect(await first).toBe('aborted')
    expect(await second).toBe('aborted')
    expect(killed).toBe(true)
  })

  it('starts a fresh decode after the shared one settles', async () => {
    // The in-flight entry must be dropped on settle, or a file re-analyzed after an edit
    // would be pinned to the result of the decode that ran before it changed.
    let runs = 0
    const shared = createSharedScan(
      () => {
        runs++
        return Promise.resolve({ ok: true as const })
      },
      () => {},
    )
    await shared('/t.flac')
    await shared('/t.flac')
    expect(runs).toBe(2)
  })

  it('shares one decode between concurrent callers', async () => {
    // The reason this exists at all: two probes, one ffmpeg pass.
    let runs = 0
    let settle: ((v: { ok: true }) => void) | undefined
    const shared = createSharedScan(
      () => {
        runs++
        return new Promise<{ ok: true }>((res) => {
          settle = res
        })
      },
      () => {},
    )
    const a = shared('/t.flac')
    const b = shared('/t.flac')
    settle?.({ ok: true })
    await Promise.all([a, b])
    expect(runs).toBe(1)
  })
})
