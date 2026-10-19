// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { UsbExportEvent } from '../../../shared/types'
import { stubApi } from '../test/api'
import { connectUsbExportFeed, createUsbExportStore, useUsbExportState } from './usbExportStore'

const STARTED: UsbExportEvent = {
  type: 'started',
  tracks: [
    {
      id: 'a',
      title: 'A',
      artist: '',
      size: 10,
      onStick: false,
      separator: false,
      cover: null,
      wave: null,
    },
  ],
  targetName: 'Surco',
  startedAt: 0,
}

describe('usbExportStore', () => {
  // The export outlives the modal: the main process events feed a store App never owns.
  it('folds the main process events in', () => {
    let emit: (e: UsbExportEvent) => void = () => {}
    ;(window as unknown as { api: Api }).api = stubApi({
      onUsbEvent: (cb) => {
        emit = cb
        return () => {}
      },
    })
    const store = createUsbExportStore(() => 0)
    const off = connectUsbExportFeed(store)
    emit(STARTED)
    expect(store.getState().phase).toBe('copying')
    off()
  })

  // A byte tick must not re-render a component that only reads the phase.
  it('re-renders a subscriber only when its slice changes', () => {
    const store = createUsbExportStore(() => 0)
    store.dispatch(STARTED)
    const renders = vi.fn()
    renderHook(() => {
      renders()
      return useUsbExportState((s) => s.phase, store)
    })
    const before = renders.mock.calls.length
    act(() => store.dispatch({ type: 'progress', index: 0, bytes: 5 }))
    expect(renders.mock.calls.length).toBe(before)
    act(() => store.dispatch({ type: 'database' }))
    expect(renders.mock.calls.length).toBe(before + 1)
  })
})
