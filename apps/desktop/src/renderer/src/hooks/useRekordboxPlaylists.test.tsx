// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Settings } from '../../../shared/types'
import { installApi } from '../test/api'
import type { TrackItem } from '../types'
import {
  useOfferRekordboxField,
  useRekordboxListMembership,
  useRekordboxMembership,
  useRekordboxPlaylistOptions,
} from './useRekordboxPlaylists'

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

describe('useRekordboxPlaylists', () => {
  it('turns the tree into options with their folder paths', async () => {
    installApi({
      loadRekordboxTree: vi.fn<Api['loadRekordboxTree']>(async () => [
        {
          id: '1',
          name: 'BOLOS',
          kind: 'folder',
          count: 1,
          children: [{ id: '2', name: 'Verano', kind: 'playlist', count: 3 }],
        },
      ]),
    })
    const { result } = renderHook(() => useRekordboxPlaylistOptions(true), { wrapper })
    await waitFor(() =>
      expect(result.current).toEqual([{ id: '2', name: 'Verano', path: 'BOLOS' }]),
    )
  })

  it('has no options while the tree has not arrived, so the field is not drawn half-known', () => {
    installApi({
      loadRekordboxTree: vi.fn<Api['loadRekordboxTree']>(() => new Promise(() => {})),
    })
    const { result } = renderHook(() => useRekordboxPlaylistOptions(true), { wrapper })
    expect(result.current).toBeUndefined()
  })

  it('asks main once for every path, sorted and without repeats, never one read per row', async () => {
    const rekordboxMembership = vi.fn<Api['rekordboxMembership']>(async () => ({
      '/m/a.wav': ['3000'],
    }))
    installApi({ rekordboxMembership })
    const { result } = renderHook(
      () => useRekordboxMembership(['/m/b.wav', '/m/a.wav', '/m/b.wav'], true),
      { wrapper },
    )
    await waitFor(() => expect(result.current).toEqual({ '/m/a.wav': ['3000'] }))
    expect(rekordboxMembership).toHaveBeenCalledTimes(1)
    expect(rekordboxMembership).toHaveBeenCalledWith(['/m/a.wav', '/m/b.wav'])
  })

  it('keeps the previous membership while the next one loads only when the list asks for it', async () => {
    const rekordboxMembership = vi.fn<Api['rekordboxMembership']>(
      (paths) =>
        new Promise((resolve) => {
          if (paths[0] === '/m/a.wav') resolve({ '/m/a.wav': ['3000'] })
        }),
    )
    installApi({ rekordboxMembership })
    const { result, rerender } = renderHook(
      ({ path, keep }) => ({
        strict: useRekordboxMembership([path], true),
        kept: useRekordboxMembership([path], true, { keepPrevious: keep }),
      }),
      { wrapper, initialProps: { path: '/m/a.wav', keep: true } },
    )
    await waitFor(() => expect(result.current.strict).toEqual({ '/m/a.wav': ['3000'] }))
    rerender({ path: '/m/b.wav', keep: true })
    expect(result.current.strict).toBeUndefined()
    expect(result.current.kept).toEqual({ '/m/a.wav': ['3000'] })
  })

  it('asks nothing while disabled', () => {
    const rekordboxMembership = vi.fn<Api['rekordboxMembership']>(async () => ({}))
    installApi({ rekordboxMembership })
    const { result } = renderHook(() => useRekordboxMembership(['/m/a.wav'], false), { wrapper })
    expect(rekordboxMembership).not.toHaveBeenCalled()
    expect(result.current).toBeUndefined()
  })

  it('offers the field once, when a collection is there', () => {
    const save = vi.fn()
    const settings = { visibleFields: ['title'], rekordboxPlaylistsFieldOffered: false } as Settings
    renderHook(() => useOfferRekordboxField(settings, true, save))
    expect(save).toHaveBeenCalledWith({
      visibleFields: ['title', 'rekordboxPlaylists'],
      rekordboxPlaylistsFieldOffered: true,
    })
    save.mockClear()
    renderHook(() =>
      useOfferRekordboxField({ ...settings, rekordboxPlaylistsFieldOffered: true }, true, save),
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('tries the offer once per session even if the save is rolled back', () => {
    const save = vi.fn()
    const settings = { visibleFields: ['title'], rekordboxPlaylistsFieldOffered: false } as Settings
    const { rerender } = renderHook(({ current }) => useOfferRekordboxField(current, true, save), {
      initialProps: { current: settings },
    })
    rerender({ current: { ...settings } })
    rerender({ current: { ...settings } })
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('asks once for a burst of path changes inside a second, so a batch conversion is not a read per track', async () => {
    vi.useFakeTimers()
    try {
      const rekordboxMembership = vi.fn<Api['rekordboxMembership']>(async () => ({}))
      installApi({ rekordboxMembership })
      const at = (n: number) =>
        [{ inputPath: '/m/a.wav', outputPath: `/o/a${n}.wav` }] as unknown as TrackItem[]
      const { rerender } = renderHook(({ tracks }) => useRekordboxListMembership(tracks, true), {
        wrapper,
        initialProps: { tracks: at(0) },
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      rekordboxMembership.mockClear()
      for (const n of [1, 2, 3]) {
        rerender({ tracks: at(n) })
        await act(async () => {
          await vi.advanceTimersByTimeAsync(300)
        })
      }
      expect(rekordboxMembership).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000)
      })
      expect(rekordboxMembership).toHaveBeenCalledTimes(1)
      expect(rekordboxMembership).toHaveBeenCalledWith(['/o/a3.wav'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does no work for the list while rekordbox is unavailable', async () => {
    const rekordboxMembership = vi.fn<Api['rekordboxMembership']>(async () => ({}))
    installApi({ rekordboxMembership })
    const tracks = [{ inputPath: '/m/a.wav' }] as unknown as TrackItem[]
    const { result } = renderHook(() => useRekordboxListMembership(tracks, false), { wrapper })
    expect(result.current).toBeUndefined()
    expect(rekordboxMembership).not.toHaveBeenCalled()
  })
})
