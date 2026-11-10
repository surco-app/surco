// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { DjProgram } from '../../../shared/djProgram'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { djReads, type ProgramReads, stubApi } from '../test/api'
import { useSessionRows } from './useSessionRows'

afterEach(cleanup)

const rows = (path: string): SourcePlaylistEntry[] => [{ path, separator: false, meta: {} }]

function install(over: Partial<Api>): Api {
  const api = stubApi(over)
  ;(window as unknown as { api: Api }).api = api
  return api
}

function playlistReads(api: Api, program: DjProgram) {
  return vi.mocked(api.dj.playlist).mock.calls.filter(([p]) => p === program)
}

describe('useSessionRows reset', () => {
  it('reads a playlist again after a reset, so edits made meanwhile are seen', async () => {
    const api = install({
      dj: djReads({ rekordbox: { playlist: vi.fn(async () => rows('/m/a.mp3')) } }),
    })
    const { result } = renderHook(() => useSessionRows('rekordbox'))
    await act(async () => {
      await result.current.load(['a'])
    })
    act(() => result.current.reset())
    await act(async () => {
      await result.current.load(['a'])
    })
    expect(playlistReads(api, 'rekordbox')).toHaveLength(2)
  })

  it('forgets the playlists that failed to read', async () => {
    install({
      dj: djReads({
        rekordbox: { playlist: vi.fn(async () => Promise.reject(new Error('gone'))) },
      }),
    })
    const { result } = renderHook(() => useSessionRows('rekordbox'))
    await act(async () => {
      await result.current.load(['bad'])
    })
    expect(result.current.failed).toEqual(['bad'])
    act(() => result.current.reset())
    expect(result.current.failed).toEqual([])
  })

  it('stops naming a playlist as failed once it reads fine', async () => {
    const read = vi
      .fn<ProgramReads['playlist']>()
      .mockRejectedValueOnce(new Error('gone'))
      .mockResolvedValue(rows('/m/a.mp3'))
    install({ dj: djReads({ rekordbox: { playlist: read } }) })
    const { result } = renderHook(() => useSessionRows('rekordbox'))
    await act(async () => {
      await result.current.load(['a'])
    })
    expect(result.current.failed).toEqual(['a'])
    await act(async () => {
      await result.current.load(['a'])
    })
    expect(result.current.failed).toEqual([])
  })

  it('keeps its function stable, so callers can depend on it', () => {
    install({})
    const { result, rerender } = renderHook(() => useSessionRows('rekordbox'))
    const first = result.current.reset
    rerender()
    expect(result.current.reset).toBe(first)
  })
})

describe('useSessionRows', () => {
  it('does not reuse a read of the same id that belongs to another program', async () => {
    const api = install({
      dj: djReads({
        rekordbox: { playlist: vi.fn(async () => rows('/m/rb.mp3')) },
        traktor: { playlist: vi.fn(async () => rows('/m/tk.mp3')) },
      }),
    })
    const { result, rerender } = renderHook(({ program }) => useSessionRows(program), {
      initialProps: { program: 'rekordbox' as 'rekordbox' | 'traktor' },
    })

    await act(async () => {
      await result.current.load(['1'])
    })
    rerender({ program: 'traktor' })
    let loaded: Awaited<ReturnType<typeof result.current.load>> | undefined
    await act(async () => {
      loaded = await result.current.load(['1'])
    })

    expect(playlistReads(api, 'traktor')).toHaveLength(1)
    expect(loaded?.get('1')?.[0].path).toBe('/m/tk.mp3')
  })

  it('does not carry a failure of one program over to another', async () => {
    install({
      dj: djReads({
        serato: { playlist: vi.fn(async () => Promise.reject(new Error('gone'))) },
        rekordbox: { playlist: vi.fn(async () => rows('/m/a.mp3')) },
      }),
    })
    const { result, rerender } = renderHook(({ program }) => useSessionRows(program), {
      initialProps: { program: 'serato' as 'serato' | 'rekordbox' },
    })
    await act(async () => {
      await result.current.load(['x'])
    })
    expect(result.current.failed).toEqual(['x'])

    rerender({ program: 'rekordbox' })

    expect(result.current.failed).toEqual([])
  })

  it('reads a playlist once however many times it is asked for', async () => {
    const api = install({
      dj: djReads({ rekordbox: { playlist: vi.fn(async () => rows('/m/a.mp3')) } }),
    })
    const { result } = renderHook(() => useSessionRows('rekordbox'))

    await act(async () => {
      await result.current.load(['a'])
      await result.current.load(['a'])
    })

    expect(playlistReads(api, 'rekordbox')).toHaveLength(1)
  })

  it('shares one read between two asks that arrive together', async () => {
    const api = install({
      dj: djReads({ rekordbox: { playlist: vi.fn(async () => rows('/m/a.mp3')) } }),
    })
    const { result } = renderHook(() => useSessionRows('rekordbox'))

    await act(async () => {
      await Promise.all([result.current.load(['a']), result.current.load(['a'])])
    })

    expect(playlistReads(api, 'rekordbox')).toHaveLength(1)
  })

  it('reads each different playlist and returns them by id', async () => {
    install({
      dj: djReads({ traktor: { playlist: vi.fn(async (id: string) => rows(`/m/${id}.mp3`)) } }),
    })
    const { result } = renderHook(() => useSessionRows('traktor'))

    let loaded: Awaited<ReturnType<typeof result.current.load>> | undefined
    await act(async () => {
      loaded = await result.current.load(['x', 'y'])
    })

    expect(loaded?.get('x')?.[0].path).toBe('/m/x.mp3')
    expect(loaded?.get('y')?.[0].path).toBe('/m/y.mp3')
  })

  it('reports a playlist that fails to read without dropping the others', async () => {
    install({
      dj: djReads({
        serato: {
          playlist: vi.fn(async (id: string) => {
            if (id === 'bad') throw new Error('gone')
            return rows(`/m/${id}.mp3`)
          }),
        },
      }),
    })
    const { result } = renderHook(() => useSessionRows('serato'))

    let loaded: Awaited<ReturnType<typeof result.current.load>> | undefined
    await act(async () => {
      loaded = await result.current.load(['good', 'bad'])
    })

    expect(loaded?.has('good')).toBe(true)
    expect(loaded?.has('bad')).toBe(false)
    expect(result.current.failed).toEqual(['bad'])
  })

  it('names a failing playlist once even when asked again', async () => {
    install({
      dj: djReads({ serato: { playlist: vi.fn(async () => Promise.reject(new Error('gone'))) } }),
    })
    const { result } = renderHook(() => useSessionRows('serato'))

    await act(async () => {
      await result.current.load(['bad'])
      await result.current.load(['bad'])
    })

    expect(result.current.failed).toEqual(['bad'])
  })

  it('is loading while a read is in flight and not after', async () => {
    let release: (value: SourcePlaylistEntry[]) => void = () => {}
    install({
      dj: djReads({
        rekordbox: {
          playlist: vi.fn(
            () => new Promise<SourcePlaylistEntry[]>((resolve) => (release = resolve)),
          ),
        },
      }),
    })
    const { result } = renderHook(() => useSessionRows('rekordbox'))
    expect(result.current.loading).toBe(false)

    let pending: Promise<unknown> = Promise.resolve()
    act(() => {
      pending = result.current.load(['a'])
    })
    await waitFor(() => expect(result.current.loading).toBe(true))

    await act(async () => {
      release(rows('/m/a.mp3'))
      await pending
    })
    expect(result.current.loading).toBe(false)
  })
})
