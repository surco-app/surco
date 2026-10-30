// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ProgramCopies, RekordboxQueueState } from '../../../shared/types'
import { installApi } from '../test/api'
import { useCopies } from './useCopies'

const rekordbox = (pending: number): ProgramCopies => ({
  program: 'rekordbox',
  collectionPath: '/lib/master.db',
  copies: [],
  restore: null,
  pending,
  halted: false,
  copyFailed: false,
  untouched: false,
})

describe('useCopies', () => {
  it('reloads on mount, when the copies change and when any queue changes', async () => {
    const listeners: (() => void)[] = []
    const listen = (cb: (state: RekordboxQueueState) => void) => {
      listeners.push(() => cb({ tracks: 0, changes: 0, items: [] }))
      return () => {}
    }
    let pending = 0
    const copiesStatus = vi.fn(async () => [rekordbox(pending)])
    installApi({
      copiesStatus,
      onCopiesChanged: listen,
      onRekordboxQueueChanged: listen,
      onEngineCueQueueChanged: listen,
      onTraktorCueQueueChanged: listen,
    })
    const { result } = renderHook(() => useCopies())
    await waitFor(() => expect(result.current.programs).toEqual([rekordbox(0)]))
    expect(listeners).toHaveLength(4)
    for (const [i, fire] of listeners.entries()) {
      pending = i + 1
      await act(async () => fire())
      await waitFor(() => expect(result.current.programs).toEqual([rekordbox(i + 1)]))
    }
  })
})
