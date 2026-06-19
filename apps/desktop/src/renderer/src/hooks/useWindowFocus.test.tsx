// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWindowFocus } from './useWindowFocus'

function setApi(onWindowFocus: ReturnType<typeof vi.fn>): void {
  ;(window as unknown as { api: unknown }).api = { onWindowFocus }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useWindowFocus', () => {
  // The handler must run with the focus state on every focus/blur the main process reports.
  it('runs the handler with the reported focus state', () => {
    let emit: ((focused: boolean) => void) | undefined
    setApi(
      vi.fn((cb) => {
        emit = cb
        return vi.fn()
      }),
    )
    const onFocus = vi.fn()
    renderHook(() => useWindowFocus(onFocus))

    emit?.(true)
    emit?.(false)
    expect(onFocus.mock.calls).toEqual([[true], [false]])
  })

  // The whole point of centralising this: the returned unsubscribe must run on unmount, or
  // a remounting component stacks a dead listener on every cycle.
  it('disposes the subscription on unmount', () => {
    const dispose = vi.fn()
    setApi(vi.fn(() => dispose))
    const { unmount } = renderHook(() => useWindowFocus(vi.fn()))

    expect(dispose).not.toHaveBeenCalled()
    unmount()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  // A re-render must not re-subscribe (which would leak the old listener): the handler is
  // stabilised, so the effect runs once even as the caller passes a fresh closure each render.
  it('subscribes once across re-renders', () => {
    const onWindowFocus = vi.fn(() => vi.fn())
    setApi(onWindowFocus)
    const { rerender } = renderHook(() => useWindowFocus(() => undefined))

    rerender()
    rerender()
    expect(onWindowFocus).toHaveBeenCalledTimes(1)
  })
})
