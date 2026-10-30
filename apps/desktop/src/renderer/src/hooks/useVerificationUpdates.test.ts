// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Verification } from '../../../shared/verification'
import type { TrackItem } from '../types'
import { useVerificationUpdates } from './useVerificationUpdates'

const ok: Verification = { status: 'ok', checks: [] }

function setup(loaded: string[]) {
  let push: (id: string, v: Verification) => void = () => {}
  const off = vi.fn()
  const onVerifyUpdate = vi.fn<Api['onVerifyUpdate']>((cb) => {
    push = cb
    return off
  })
  ;(window as unknown as { api: unknown }).api = { onVerifyUpdate }
  const updateTrack = vi.fn()
  const tracksRef = { current: loaded.map((id) => ({ id }) as TrackItem) }
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

  it('stops listening on unmount', () => {
    const { hook, off } = setup(['a'])
    hook.unmount()
    expect(off).toHaveBeenCalled()
  })
})
