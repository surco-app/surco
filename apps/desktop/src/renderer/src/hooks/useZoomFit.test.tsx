// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useZoomFit } from './useZoomFit'

describe('useZoomFit', () => {
  let listeners: Array<() => void>
  let checkZoom: ReturnType<typeof vi.fn>

  beforeEach(() => {
    listeners = []
    checkZoom = vi.fn()
    // biome-ignore lint/suspicious/noExplicitAny: minimal bridge stub for the hook under test
    ;(window as any).api = { checkZoom }
    window.matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_: string, cb: () => void) => listeners.push(cb),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('asks the window to fit the zoom it opens with, since a zoom kept from last time may not fit this screen', () => {
    renderHook(() => useZoomFit())
    expect(checkZoom).toHaveBeenCalledTimes(1)
  })

  it('asks again each time the zoom changes, so ⌘+ never leaves the editor cut off', () => {
    renderHook(() => useZoomFit())
    listeners.at(-1)?.()
    listeners.at(-1)?.()
    expect(checkZoom).toHaveBeenCalledTimes(3)
  })
})
