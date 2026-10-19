// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { RekordboxQueueApplied, RekordboxQueueState } from '../../../shared/types'
import '../i18n'
import { installApi } from '../test/api'
import { useRekordboxQueue } from './useRekordboxQueue'

afterEach(cleanup)

const WAITING: RekordboxQueueState = {
  tracks: 1,
  changes: 0,
  items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'collection' }] }],
}

function setup(over: Partial<Api> = {}) {
  let changed: (s: RekordboxQueueState) => void = () => {}
  let applied: (a: RekordboxQueueApplied) => void = () => {}
  const api = installApi({
    rekordboxQueue: vi.fn<Api['rekordboxQueue']>(async () => WAITING),
    onRekordboxQueueChanged: (cb) => {
      changed = cb
      return () => {}
    },
    onRekordboxQueueApplied: (cb) => {
      applied = cb
      return () => {}
    },
    ...over,
  })
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const notify = vi.fn()
  const onDiscarded = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useRekordboxQueue(notify, onDiscarded), { wrapper })
  return {
    hook,
    api,
    notify,
    onDiscarded,
    invalidate,
    changed: (s: RekordboxQueueState) => changed(s),
    applied: (a: RekordboxQueueApplied) => applied(a),
  }
}

describe('useRekordboxQueue', () => {
  it('reads the queue and follows its changes', async () => {
    const { hook, changed } = setup()
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    act(() => changed({ tracks: 0, changes: 0, items: [] }))
    expect(hook.result.current.state.tracks).toBe(0)
  })

  it('tells the user and re-reads rekordbox when the queue lands, because the collection is the only truth', async () => {
    const { notify, invalidate, applied } = setup()
    act(() => applied({ tracks: 2, changes: 0, notices: [] }))
    expect(notify).toHaveBeenCalledWith('Done in rekordbox · 2 tracks', 'neutral')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-membership'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['source-tree'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['source-playlist'] })
  })

  it('hands back the discarded tracks so their edits go back to rekordbox', async () => {
    const discardRekordboxQueue = vi.fn<Api['discardRekordboxQueue']>(async () => {})
    const { hook, onDiscarded } = setup({ discardRekordboxQueue })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    await act(() => hook.result.current.discard())
    expect(discardRekordboxQueue).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalledWith(['/m/a.wav'])
  })

  it('announces the answer of Apply now', async () => {
    const { hook, notify } = setup({
      applyRekordboxQueue: vi.fn<Api['applyRekordboxQueue']>(async () => ({
        tracks: 1,
        changes: 0,
        notices: [],
      })),
    })
    await act(() => hook.result.current.applyNow())
    expect(notify).toHaveBeenCalledWith('Done in rekordbox · 1 track', 'neutral')
  })

  it('keeps the pushed state when the first read answers late with an older one', async () => {
    let answer: (s: RekordboxQueueState) => void = () => {}
    const { hook, changed } = setup({
      rekordboxQueue: vi.fn<Api['rekordboxQueue']>(
        () =>
          new Promise((resolve) => {
            answer = resolve
          }),
      ),
    })
    act(() => changed({ tracks: 0, changes: 0, items: [] }))
    await act(async () => answer(WAITING))
    expect(hook.result.current.state.tracks).toBe(0)
  })

  it('says so instead of rejecting when applying now fails', async () => {
    const { hook, notify } = setup({
      applyRekordboxQueue: vi.fn<Api['applyRekordboxQueue']>(async () => {
        throw new Error('ipc')
      }),
    })
    await act(() => hook.result.current.applyNow())
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'danger')
  })

  it('keeps the edits when discarding fails, because nothing was discarded', async () => {
    const { hook, notify, onDiscarded } = setup({
      discardRekordboxQueue: vi.fn<Api['discardRekordboxQueue']>(async () => {
        throw new Error('ipc')
      }),
    })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    await act(() => hook.result.current.discard())
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'danger')
    expect(onDiscarded).not.toHaveBeenCalled()
  })
})
