// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Settings } from '../../../shared/types'
import { installApi } from '../test/api'
import {
  useOfferRekordboxField,
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
})
