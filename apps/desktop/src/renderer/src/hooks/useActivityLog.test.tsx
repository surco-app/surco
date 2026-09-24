// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../../../shared/types'
import { useActivityLog, useActivityRows } from './useActivityLog'

function feed(): (event: ActivityEvent) => void {
  let emit: (event: ActivityEvent) => void = () => {}
  ;(window as unknown as { api: unknown }).api = {
    onActivity: (cb: (event: ActivityEvent) => void) => {
      emit = cb
      return () => {}
    },
  }
  return (event) => emit(event)
}

const probe = (id: string, phase: ActivityEvent['phase']): ActivityEvent => ({
  id,
  kind: 'analyze',
  phase,
  labelKey: 'activity.spectrogram',
})

describe('useActivityLog', () => {
  // App hosts the log but only shows whether something is running; the rows belong to the
  // panel. An "analyze all" streams a start and a done per probe, several per track, and
  // each one used to re-render the whole App for a fact that had not changed.
  it('re-renders its host only when whether work is running changes', () => {
    const emit = feed()
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useActivityLog()
    })
    const before = renders

    act(() => emit(probe('1', 'start')))
    act(() => emit(probe('2', 'start')))
    act(() => emit(probe('1', 'done')))
    act(() => emit(probe('2', 'done')))

    expect(result.current.running).toBe(false)
    expect(renders - before).toBe(2)
  })

  it('hands the panel every row the feed produced', () => {
    const emit = feed()
    const { result } = renderHook(() => {
      const log = useActivityLog()
      return { log, rows: useActivityRows(log.store) }
    })

    act(() => emit(probe('1', 'start')))
    act(() => emit(probe('1', 'done')))
    act(() => result.current.log.report({ kind: 'match', labelKey: 'activity.match' }))

    expect(result.current.rows.map((r) => r.status)).toEqual(['done', 'done'])
    act(() => result.current.log.clear())
    expect(result.current.rows).toEqual([])
  })
})
