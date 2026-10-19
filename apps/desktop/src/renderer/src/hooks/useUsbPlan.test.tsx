// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { stubApi } from '../test/api'
import { useUsbPlan } from './useUsbPlan'

afterEach(() => vi.useRealTimers())

describe('useUsbPlan', () => {
  // Ticking several boxes in a row must not run baken's dry run for each one.
  it('waits for the ticking to settle before asking', async () => {
    vi.useFakeTimers()
    const usbPlan = vi.fn<Api['usbPlan']>(async () => ({ ok: false, reason: 'nothing-selected' }))
    ;(window as unknown as { api: Api }).api = stubApi({ usbPlan })
    const target = { kind: 'volume' as const, uuid: 'U' }
    const { rerender } = renderHook(
      ({ ids }) => useUsbPlan({ playlistIds: ids, target, prune: false, settings: false }),
      { initialProps: { ids: ['a'] } },
    )
    rerender({ ids: ['a', 'b'] })
    rerender({ ids: ['a', 'b', 'c'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(usbPlan).toHaveBeenCalledTimes(1)
    expect(usbPlan.mock.calls[0][0]).toMatchObject({ playlistIds: ['a', 'b', 'c'] })
  })

  // A rejected request must settle, or the summary says "Calculando…" forever.
  it('settles as broken when the request fails', async () => {
    vi.useFakeTimers()
    const usbPlan = vi.fn<Api['usbPlan']>(async () => {
      throw new Error('ipc')
    })
    ;(window as unknown as { api: Api }).api = stubApi({ usbPlan })
    const target = { kind: 'volume' as const, uuid: 'U' }
    const { result } = renderHook(() =>
      useUsbPlan({ playlistIds: ['a'], target, prune: false, settings: false }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.broken).toBe(true)
    expect(result.current.plan).toBeNull()
  })

  // A slow answer for an older selection must not overwrite the summary of the current one.
  it('drops a late answer to an older selection', async () => {
    vi.useFakeTimers()
    const answers: ((r: Awaited<ReturnType<Api['usbPlan']>>) => void)[] = []
    const usbPlan = vi.fn<Api['usbPlan']>(() => new Promise((r) => answers.push(r)))
    ;(window as unknown as { api: Api }).api = stubApi({ usbPlan })
    const target = { kind: 'volume' as const, uuid: 'U' }
    const { result, rerender } = renderHook(
      ({ ids }) => useUsbPlan({ playlistIds: ids, target, prune: false, settings: false }),
      { initialProps: { ids: ['a'] } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    rerender({ ids: ['b'] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350)
    })
    await act(async () => answers[1]({ ok: false, reason: 'playlist-empty' }))
    await act(async () => answers[0]({ ok: false, reason: 'unreadable' }))
    expect(result.current.failure).toBe('playlist-empty')
    expect(result.current.loading).toBe(false)
  })
})
