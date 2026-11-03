// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { installApi } from '../test/api'
import { resetGridVerdicts, useGridVerdicts } from './useGridVerdicts'

afterEach(resetGridVerdicts)

const ENTRIES: [string, string][] = [
  ['t1', '101'],
  ['t2', '102'],
  ['t3', '103'],
]

function api() {
  const rekordboxGridVerdict = vi.fn<Api['rekordboxGridVerdict']>(async (id) =>
    id === '102' ? { kind: 'shifted', ms: -92 } : null,
  )
  installApi({ rekordboxGridVerdict })
  return rekordboxGridVerdict
}

describe('useGridVerdicts', () => {
  it('measures nothing until the filter asks, since each track means decoding its audio', () => {
    const measure = api()
    const { result } = renderHook(() => useGridVerdicts(ENTRIES, false))
    expect(measure).not.toHaveBeenCalled()
    expect(result.current.done).toBe(0)
    expect(result.current.total).toBe(3)
  })

  it('measures every rekordbox row of the list once asked, counting how far it got', async () => {
    const measure = api()
    const { result } = renderHook(() => useGridVerdicts(ENTRIES, true))
    await waitFor(() => expect(result.current.done).toBe(3))
    expect(measure).toHaveBeenCalledTimes(3)
    expect(result.current.verdictOf('t2')).toEqual({ kind: 'shifted', ms: -92 })
    expect(result.current.verdictOf('t1')).toBeNull()
  })

  it('keeps what it measured for the session, so turning the filter on again is instant', async () => {
    const measure = api()
    const first = renderHook(() => useGridVerdicts(ENTRIES, true))
    await waitFor(() => expect(first.result.current.done).toBe(3))
    first.unmount()
    const again = renderHook(() => useGridVerdicts(ENTRIES, true))
    expect(again.result.current.done).toBe(3)
    expect(measure).toHaveBeenCalledTimes(3)
  })

  it('stops measuring when the filter is turned off', async () => {
    let release: () => void = () => {}
    const rekordboxGridVerdict = vi.fn<Api['rekordboxGridVerdict']>(
      () =>
        new Promise((resolve) => {
          release = () => resolve(null)
        }),
    )
    installApi({ rekordboxGridVerdict })
    const { rerender } = renderHook(({ on }) => useGridVerdicts(ENTRIES, on), {
      initialProps: { on: true },
    })
    await waitFor(() => expect(rekordboxGridVerdict).toHaveBeenCalled())
    const asked = rekordboxGridVerdict.mock.calls.length
    rerender({ on: false })
    await act(async () => release())
    expect(rekordboxGridVerdict).toHaveBeenCalledTimes(asked)
  })
})
