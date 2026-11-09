// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { SourcePlaylistEntry } from '../../../shared/types'
import { stubApi } from '../test/api'
import { useSessionRows } from './useSessionRows'

afterEach(cleanup)

const rows = (path: string): SourcePlaylistEntry[] => [{ path, separator: false, meta: {} }]

function install(over: Partial<Api>): Api {
  const api = stubApi(over)
  ;(window as unknown as { api: Api }).api = api
  return api
}

describe('useSessionRows', () => {
  it('reads a playlist once however many times it is asked for', async () => {
    const api = install({ loadRekordboxPlaylist: vi.fn(async () => rows('/m/a.mp3')) })
    const { result } = renderHook(() => useSessionRows('rekordbox'))

    await act(async () => {
      await result.current.load(['a'])
      await result.current.load(['a'])
    })

    expect(api.loadRekordboxPlaylist).toHaveBeenCalledTimes(1)
  })

  it('shares one read between two asks that arrive together', async () => {
    const api = install({ loadRekordboxPlaylist: vi.fn(async () => rows('/m/a.mp3')) })
    const { result } = renderHook(() => useSessionRows('rekordbox'))

    await act(async () => {
      await Promise.all([result.current.load(['a']), result.current.load(['a'])])
    })

    expect(api.loadRekordboxPlaylist).toHaveBeenCalledTimes(1)
  })

  it('reads each different playlist and returns them by id', async () => {
    install({
      loadTraktorPlaylist: vi.fn(async (id: string) => rows(`/m/${id}.mp3`)),
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
      loadSeratoPlaylist: vi.fn(async (id: string) => {
        if (id === 'bad') throw new Error('gone')
        return rows(`/m/${id}.mp3`)
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
    install({ loadSeratoPlaylist: vi.fn(async () => Promise.reject(new Error('gone'))) })
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
      loadRekordboxPlaylist: vi.fn(
        () => new Promise<SourcePlaylistEntry[]>((resolve) => (release = resolve)),
      ),
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
