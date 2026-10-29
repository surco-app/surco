// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColumnShares } from '../../../shared/types'
import { columnWidths } from '../lib/columnLayout'
import { useColumnLayout } from './useColumnLayout'

function setWindowWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
}

function pointerDown(clientX: number): React.PointerEvent {
  return { clientX, preventDefault: () => {} } as unknown as React.PointerEvent
}

function pointer(type: 'pointermove' | 'pointerup', clientX: number): void {
  const event = new Event(type) as Event & { clientX: number }
  Object.defineProperty(event, 'clientX', { value: clientX })
  window.dispatchEvent(event)
}

function flushFrames(): void {
  act(() => vi.runAllTimers())
}

function setup(saved?: ColumnShares) {
  const onCommit = vi.fn<(shares: ColumnShares) => void>()
  const hook = renderHook(
    (props: { saved?: ColumnShares }) =>
      useColumnLayout({ hasRail: true, hasTree: true, saved: props.saved, onCommit }),
    { initialProps: { saved } },
  )
  return { ...hook, onCommit }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  setWindowWidth(1440)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useColumnLayout', () => {
  it('sizes the columns from the window minus the source rail and the two dividers', () => {
    const { result } = setup()
    expect(result.current.widths).toEqual(columnWidths(1370, true, undefined))
  })

  it('reads the saved shares, so a drag from an earlier session comes back', () => {
    const { result } = setup({ results: 0.25 })
    expect(result.current.widths.results).toBe(343)
  })

  it('follows the window as it is resized, keeping the proportions', () => {
    const { result } = setup()
    setWindowWidth(1728)
    act(() => window.dispatchEvent(new Event('resize')))
    flushFrames()
    expect(result.current.widths).toEqual(columnWidths(1658, true, undefined))
  })

  it('catches a resize that lands while the app is still mounting, as the window does on launch', () => {
    let reads = 0
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      get: () => (reads++ === 0 ? 1320 : 1280),
    })
    const { result } = setup()
    expect(result.current.widths).toEqual(columnWidths(1210, true, undefined))
  })

  it('commits a share, not a pixel width, when a drag ends', () => {
    const { result, onCommit } = setup()
    act(() => result.current.startResize('results', pointerDown(500)))
    act(() => pointer('pointermove', 520))
    flushFrames()
    expect(result.current.widths.results).toBe(321)
    act(() => pointer('pointerup', 520))
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit.mock.calls[0][0].results).toBeCloseTo(321 / 1370)
  })

  it('keeps the other saved shares when one column is dragged', () => {
    const { result, onCommit } = setup({ results: 0.3 })
    act(() => result.current.startResize('list', pointerDown(300)))
    act(() => pointer('pointermove', 340))
    act(() => pointer('pointerup', 340))
    expect(onCommit.mock.calls[0][0]).toEqual({ results: 0.3, list: 369 / 1370 })
  })

  it('commits nothing for a click on the divider that moves nothing', () => {
    const { result, onCommit } = setup()
    act(() => result.current.startResize('list', pointerDown(300)))
    act(() => pointer('pointerup', 300))
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('commits a share for the double-click fit as well', () => {
    const { result, onCommit } = setup()
    act(() => result.current.fit('list', 49))
    expect(onCommit).toHaveBeenCalledWith({ list: 377 / 1370 })
  })

  it('saves the width the drag shows, so the form keeps its minimum on a wider window too', () => {
    const { result, onCommit } = setup()
    act(() => result.current.startResize('results', pointerDown(500)))
    act(() => pointer('pointermove', 600))
    flushFrames()
    const shown = result.current.widths
    expect(shown.form).toBe(460)
    act(() => pointer('pointerup', 600))
    expect(onCommit.mock.calls[0][0].results).toBeCloseTo(shown.results / 1370)
  })

  it.each(['results', 'list'] as const)(
    'saves nothing when the %s divider is dragged while the form is already at its floor',
    (column) => {
      setWindowWidth(1280)
      const { result, onCommit } = setup()
      const before = result.current.widths
      act(() => result.current.startResize(column, pointerDown(500)))
      act(() => pointer('pointermove', 600))
      flushFrames()
      expect(result.current.widths).toEqual(before)
      act(() => pointer('pointerup', 600))
      expect(onCommit).not.toHaveBeenCalled()
      expect(result.current.widths).toEqual(before)
    },
  )

  it.each(['results', 'list'] as const)(
    'saves nothing when the %s fit asks for room the form cannot give',
    (column) => {
      setWindowWidth(1280)
      const { result, onCommit } = setup()
      act(() => result.current.fit(column, 100))
      expect(onCommit).not.toHaveBeenCalled()
    },
  )

  it('leaves the width alone when the fit has nothing to measure', () => {
    const { result, onCommit } = setup()
    act(() => result.current.fit('list', 0))
    expect(onCommit).not.toHaveBeenCalled()
  })
})
