// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Verification } from '../../../shared/verification'
import type { TrackItem } from '../types'
import { useVerificationUpdates } from './useVerificationUpdates'

const ok: Verification = { status: 'ok', checks: [] }

function setup(loaded: string[], verification?: Verification) {
  let push: (id: string, v: Verification) => void = () => {}
  const off = vi.fn()
  const onVerifyUpdate = vi.fn<Api['onVerifyUpdate']>((cb) => {
    push = cb
    return off
  })
  ;(window as unknown as { api: unknown }).api = { onVerifyUpdate }
  const updateTrack = vi.fn()
  const tracksRef = { current: loaded.map((id) => ({ id, verification }) as TrackItem) }
  const hook = renderHook(() => useVerificationUpdates({ tracksRef, updateTrack }))
  return { push: (id: string, v: Verification) => push(id, v), updateTrack, off, hook }
}

afterEach(() => vi.restoreAllMocks())

describe('useVerificationUpdates', () => {
  // A late check must land on its own row, never on a neighbour.
  it('a verify:update for a track updates only that track', () => {
    const { push, updateTrack } = setup(['a', 'b'])
    push('b', ok)
    expect(updateTrack).toHaveBeenCalledTimes(1)
    expect(updateTrack).toHaveBeenCalledWith('b', { verification: ok })
  })

  // The user may have removed the row while main was still checking.
  it('an update for a track no longer loaded is ignored', () => {
    const { push, updateTrack } = setup(['a'])
    push('gone', ok)
    expect(updateTrack).not.toHaveBeenCalled()
  })

  // A check of an older conversion must not repaint the row of the newer one.
  it('a late update from an older job is ignored', () => {
    const { push, updateTrack } = setup(['a'], {
      status: 'checking',
      checks: [],
      job: 'j2',
      seq: 0,
    })
    push('a', { ...ok, job: 'j1', seq: 5 })
    expect(updateTrack).not.toHaveBeenCalled()
  })

  it('an update that is not newer than the row is ignored', () => {
    const { push, updateTrack } = setup(['a'], { ...ok, job: 'j1', seq: 2 })
    push('a', { status: 'checking', checks: [], job: 'j1', seq: 2 })
    push('a', { status: 'checking', checks: [], job: 'j1', seq: 1 })
    expect(updateTrack).not.toHaveBeenCalled()
  })

  it('a newer update of the same job lands', () => {
    const { push, updateTrack } = setup(['a'], {
      status: 'checking',
      checks: [],
      job: 'j1',
      seq: 0,
    })
    const next = { ...ok, job: 'j1', seq: 1 }
    push('a', next)
    expect(updateTrack).toHaveBeenCalledWith('a', { verification: next })
  })

  it('a re-render does not subscribe twice', () => {
    const { hook } = setup(['a'])
    hook.rerender()
    hook.rerender()
    expect(window.api.onVerifyUpdate).toHaveBeenCalledTimes(1)
  })

  it('stops listening on unmount', () => {
    const { hook, off } = setup(['a'])
    hook.unmount()
    expect(off).toHaveBeenCalled()
  })
})
