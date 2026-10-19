// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { UsbVolumeList } from '../../../shared/types'
import { stubApi } from '../test/api'
import { useUsbVolumes } from './useUsbVolumes'

describe('useUsbVolumes', () => {
  // The first read can answer after a change event already brought a newer list (a stick
  // plugged in while main was still reading); the stale answer must not bring back the
  // list without it.
  it('keeps a change that arrives before the first answer', async () => {
    let answer: (l: UsbVolumeList) => void = () => {}
    let changed: (l: UsbVolumeList) => void = () => {}
    ;(window as unknown as { api: Api }).api = stubApi({
      usbVolumes: vi.fn<Api['usbVolumes']>(() => new Promise((r) => (answer = r))),
      onUsbVolumesChanged: (cb) => {
        changed = cb
        return () => {}
      },
    })
    const { result } = renderHook(() => useUsbVolumes(true))
    const newer: UsbVolumeList = { volumes: [], lastKey: 'volume:NEW' }
    act(() => changed(newer))
    await act(async () => answer({ volumes: [], lastKey: 'volume:OLD' }))
    expect(result.current.list).toBe(newer)
  })
})
