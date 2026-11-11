// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { RekordboxQueueApplied, RekordboxQueueState } from '../../../shared/types'
import '../i18n'
import { djReads, installApi, type ProgramReads } from '../test/api'
import { ENGINE_CUE_QUEUE, SERATO_CUE_QUEUE, useRekordboxQueue } from './useRekordboxQueue'

afterEach(cleanup)

const WAITING: RekordboxQueueState = {
  tracks: 1,
  changes: 0,
  items: [{ key: 'track:/m/a.wav', label: 'a', parts: [{ kind: 'collection' }] }],
}

function setup(over: Partial<ProgramReads> = {}, apiOver: Partial<Api> = {}) {
  let changed: (s: RekordboxQueueState) => void = () => {}
  let applied: (a: RekordboxQueueApplied) => void = () => {}
  const api = installApi({
    dj: djReads({
      rekordbox: {
        cueQueue: vi.fn<ProgramReads['cueQueue']>(async () => WAITING),
        onCueQueueChanged: (cb) => {
          changed = cb
          return () => {}
        },
        onCueQueueApplied: (cb) => {
          applied = cb
          return () => {}
        },
        ...over,
      },
    }),
    ...apiOver,
  })
  const client = new QueryClient()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const notify = vi.fn()
  const onDiscarded = vi.fn()
  const onWritten = vi.fn()
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useRekordboxQueue(notify, onDiscarded, onWritten), { wrapper })
  return {
    hook,
    api,
    notify,
    onDiscarded,
    onWritten,
    invalidate,
    changed: (s: RekordboxQueueState) => changed(s),
    applied: (a: RekordboxQueueApplied) => applied(a),
  }
}

describe('useRekordboxQueue', () => {
  it('tells main it listens only after subscribing to what lands, so the startup apply reaches the window', async () => {
    let listening = false
    const seen: boolean[] = []
    const cueQueueReady = vi.fn<ProgramReads['cueQueueReady']>(async () => {
      seen.push(listening)
    })
    setup({
      cueQueueReady,
      onCueQueueApplied: () => {
        listening = true
        return () => {}
      },
    })
    await waitFor(() => expect(seen).toEqual([true]))
  })

  it('reads the queue and follows its changes', async () => {
    const { hook, changed } = setup()
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    act(() => changed({ tracks: 0, changes: 0, items: [] }))
    expect(hook.result.current.state.tracks).toBe(0)
  })

  it('tells the user and re-reads rekordbox when the queue lands, because the collection is the only truth', async () => {
    const { notify, invalidate, applied } = setup()
    act(() => applied({ tracks: 2, changes: 0, notices: [], written: [] }))
    expect(notify).toHaveBeenCalledWith('Done in rekordbox · 2 tracks', 'neutral')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-membership'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['source-tree'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['source-playlist'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-track-cues'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-queued-cues'] })
  })

  it('re-reads the crates of every DJ library when a queue lands, so a crate field never shows the membership from before the write', () => {
    const { invalidate, applied } = setup()
    act(() => applied({ tracks: 1, changes: 0, notices: [], written: [] }))
    for (const key of [
      'rekordbox-membership',
      'traktor-membership',
      'engine-membership',
      'serato-membership',
    ])
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] })
  })

  it('hands the notice the cue rekordbox left off its grid, so the DJ can go straight to it', async () => {
    const { notify, applied } = setup()
    const unfit = { code: 'cues-unfit' as const, track: 'Pray', count: 1, contentId: '7', ms: 1000 }
    act(() => applied({ tracks: 0, changes: 1, notices: [unfit], written: [] }))
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Pray'), 'neutral', {
      contentId: '7',
      ms: 1000,
    })
  })

  it('hands back what landed so the fields the collection now holds are cleared', async () => {
    const { onWritten, applied } = setup()
    const written = [{ path: '/m/a.wav', wanted: [{ name: 'Surco prueba A' }] }]
    act(() => applied({ tracks: 1, changes: 0, notices: [], written }))
    expect(onWritten).toHaveBeenCalledWith(written)
  })

  it('hands back the discarded tracks so their edits go back to rekordbox', async () => {
    const discardCueQueue = vi.fn<ProgramReads['discardCueQueue']>(async () => {})
    const { hook, onDiscarded } = setup({ discardCueQueue })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    await act(() => hook.result.current.discard())
    expect(discardCueQueue).toHaveBeenCalled()
    expect(onDiscarded).toHaveBeenCalledWith(['/m/a.wav'])
  })

  it('announces the answer of Apply now', async () => {
    const { hook, notify } = setup({
      applyCueQueue: vi.fn<ProgramReads['applyCueQueue']>(async () => ({
        tracks: 1,
        changes: 0,
        notices: [],
        written: [],
      })),
    })
    await act(() => hook.result.current.applyNow())
    expect(notify).toHaveBeenCalledWith('Done in rekordbox · 1 track', 'neutral')
  })

  it('keeps the pushed state when the first read answers late with an older one', async () => {
    let answer: (s: RekordboxQueueState) => void = () => {}
    const { hook, changed } = setup({
      cueQueue: vi.fn<ProgramReads['cueQueue']>(
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
      applyCueQueue: vi.fn<ProgramReads['applyCueQueue']>(async () => {
        throw new Error('ipc')
      }),
    })
    await act(() => hook.result.current.applyNow())
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'danger')
  })

  it('keeps the edits when discarding fails, because nothing was discarded', async () => {
    const { hook, notify, onDiscarded } = setup({
      discardCueQueue: vi.fn<ProgramReads['discardCueQueue']>(async () => {
        throw new Error('ipc')
      }),
    })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    await act(() => hook.result.current.discard())
    expect(notify).toHaveBeenCalledWith(expect.any(String), 'danger')
    expect(onDiscarded).not.toHaveBeenCalled()
  })

  it('logs a first read that fails instead of swallowing it', async () => {
    const logError = vi.fn<Api['logError']>()
    setup(
      {
        cueQueue: vi.fn<ProgramReads['cueQueue']>(async () => {
          throw new Error('ipc down')
        }),
      },
      { logError },
    )
    await waitFor(() => expect(logError).toHaveBeenCalledWith(expect.stringContaining('ipc down')))
  })
})

describe('useRekordboxQueue on the Engine DJ cue queue', () => {
  it('follows the Engine queue and announces what landed in Engine DJ’s words, re-reading the cues', async () => {
    let applied: (a: RekordboxQueueApplied) => void = () => {}
    const engineCueQueueReady = vi.fn<ProgramReads['cueQueueReady']>(async () => {})
    installApi({
      dj: djReads({
        engine: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>(async () => WAITING),
          onCueQueueApplied: (cb) => {
            applied = cb
            return () => {}
          },
          cueQueueReady: engineCueQueueReady,
        },
      }),
    })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const notify = vi.fn()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useRekordboxQueue(notify, vi.fn(), vi.fn(), ENGINE_CUE_QUEUE), {
      wrapper,
    })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    expect(engineCueQueueReady).toHaveBeenCalled()
    act(() => applied({ tracks: 1, changes: 0, notices: [], written: [] }))
    expect(notify).toHaveBeenCalledWith('Done in Engine DJ · 1 track', 'neutral')
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-track-cues'] })
  })

  it('applies and discards through the Engine queue, never rekordbox’s', async () => {
    const applyEngineCueQueue = vi.fn<ProgramReads['applyCueQueue']>(async () => null)
    const discardEngineCueQueue = vi.fn<ProgramReads['discardCueQueue']>(async () => {})
    const applyRekordboxQueue = vi.fn<ProgramReads['applyCueQueue']>(async () => null)
    installApi({
      dj: djReads({
        engine: { applyCueQueue: applyEngineCueQueue, discardCueQueue: discardEngineCueQueue },
        rekordbox: { applyCueQueue: applyRekordboxQueue },
      }),
    })
    const client = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useRekordboxQueue(vi.fn(), vi.fn(), vi.fn(), ENGINE_CUE_QUEUE), {
      wrapper,
    })
    await act(() => hook.result.current.applyNow())
    await act(() => hook.result.current.discard())
    expect(applyEngineCueQueue).toHaveBeenCalled()
    expect(discardEngineCueQueue).toHaveBeenCalled()
    expect(applyRekordboxQueue).not.toHaveBeenCalled()
  })
})

describe('useRekordboxQueue on the Serato cue queue', () => {
  it('watches a Serato queue left from the last session and tells the DJ which track it could not write', async () => {
    let applied: (a: RekordboxQueueApplied) => void = () => {}
    let changed: (s: RekordboxQueueState) => void = () => {}
    const seratoCueQueueReady = vi.fn<ProgramReads['cueQueueReady']>(async () => {})
    installApi({
      dj: djReads({
        serato: {
          cueQueue: vi.fn<ProgramReads['cueQueue']>(async () => WAITING),
          onCueQueueChanged: (cb) => {
            changed = cb
            return () => {}
          },
          onCueQueueApplied: (cb) => {
            applied = cb
            return () => {}
          },
          cueQueueReady: seratoCueQueueReady,
        },
      }),
    })
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const notify = vi.fn()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useRekordboxQueue(notify, vi.fn(), vi.fn(), SERATO_CUE_QUEUE), {
      wrapper,
    })
    await waitFor(() => expect(hook.result.current.state).toEqual(WAITING))
    expect(seratoCueQueueReady).toHaveBeenCalled()
    act(() => changed({ ...WAITING, tracks: 2 }))
    expect(hook.result.current.state.tracks).toBe(2)
    act(() =>
      applied({
        tracks: 1,
        changes: 0,
        notices: [{ code: 'cues-write-failed', track: 'Tengo' }],
        written: [],
      }),
    )
    expect(notify).toHaveBeenCalledWith(
      'Done in Serato · 1 track. The cues of Tengo were not saved. Surco could not write the file',
      'neutral',
    )
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['rekordbox-track-cues'] })
  })

  it('applies and discards through the Serato queue, never rekordbox’s', async () => {
    const applySeratoCueQueue = vi.fn<ProgramReads['applyCueQueue']>(async () => null)
    const discardSeratoCueQueue = vi.fn<ProgramReads['discardCueQueue']>(async () => {})
    const applyRekordboxQueue = vi.fn<ProgramReads['applyCueQueue']>(async () => null)
    installApi({
      dj: djReads({
        serato: { applyCueQueue: applySeratoCueQueue, discardCueQueue: discardSeratoCueQueue },
        rekordbox: { applyCueQueue: applyRekordboxQueue },
      }),
    })
    const client = new QueryClient()
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useRekordboxQueue(vi.fn(), vi.fn(), vi.fn(), SERATO_CUE_QUEUE), {
      wrapper,
    })
    await act(() => hook.result.current.applyNow())
    await act(() => hook.result.current.discard())
    expect(applySeratoCueQueue).toHaveBeenCalled()
    expect(discardSeratoCueQueue).toHaveBeenCalled()
    expect(applyRekordboxQueue).not.toHaveBeenCalled()
  })
})
