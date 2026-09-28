// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useExitPresence } from './useExitPresence'

afterEach(() => vi.useRealTimers())

describe('useExitPresence', () => {
  it('stays mounted in a leaving state after it is hidden, so the exit animation is actually seen', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ present }) => useExitPresence(present, 200), {
      initialProps: { present: true },
    })
    expect(result.current).toEqual({ mounted: true, leaving: false })
    rerender({ present: false })
    expect(result.current).toEqual({ mounted: true, leaving: true })
    act(() => vi.advanceTimersByTime(199))
    expect(result.current.mounted).toBe(true)
    act(() => vi.advanceTimersByTime(1))
    expect(result.current).toEqual({ mounted: false, leaving: false })
  })

  it('never mounts something that was never shown, so a closed surface costs nothing', () => {
    const { result } = renderHook(() => useExitPresence(false, 200))
    expect(result.current).toEqual({ mounted: false, leaving: false })
  })

  it('cancels the exit when shown again mid-way, so reopening fast never unmounts the live surface', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ present }) => useExitPresence(present, 200), {
      initialProps: { present: true },
    })
    rerender({ present: false })
    act(() => vi.advanceTimersByTime(100))
    rerender({ present: true })
    expect(result.current).toEqual({ mounted: true, leaving: false })
    act(() => vi.advanceTimersByTime(500))
    expect(result.current).toEqual({ mounted: true, leaving: false })
  })

  it('plays the exit for something opened after mount, which is how the player always starts', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ present }) => useExitPresence(present, 200), {
      initialProps: { present: false },
    })
    rerender({ present: true })
    rerender({ present: false })
    expect(result.current).toEqual({ mounted: true, leaving: true })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current.mounted).toBe(false)
  })
})
