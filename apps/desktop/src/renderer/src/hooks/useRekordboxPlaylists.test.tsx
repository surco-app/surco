// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import type { Settings } from '../../../shared/types'
import { installApi } from '../test/api'
import type { TrackItem } from '../types'
import {
  useLibraryAvailable,
  useOfferPlaylistFields,
  usePlaylistsSpec,
  useRekordboxMembership,
  useRekordboxPlaylistOptions,
  useRekordboxPlaylistTree,
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

  it('hands the tree as rekordbox draws it, since the field shows its folders and counts', async () => {
    const tree = [
      {
        id: '1',
        name: 'BOLOS',
        kind: 'folder' as const,
        count: 1,
        children: [{ id: '2', name: 'Verano', kind: 'playlist' as const, count: 3 }],
      },
    ]
    installApi({ loadRekordboxTree: vi.fn<Api['loadRekordboxTree']>(async () => tree) })
    const { result } = renderHook(() => useRekordboxPlaylistTree(true), { wrapper })
    await waitFor(() => expect(result.current).toEqual(tree))
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
    renderHook(() =>
      useOfferPlaylistFields(settings, { rekordbox: true, traktor: false, engine: false }, save),
    )
    expect(save).toHaveBeenCalledWith({
      visibleFields: ['title', 'rekordboxPlaylists'],
      rekordboxPlaylistsFieldOffered: true,
    })
    save.mockClear()
    renderHook(() =>
      useOfferPlaylistFields(
        { ...settings, rekordboxPlaylistsFieldOffered: true },
        { rekordbox: true, traktor: false, engine: false },
        save,
      ),
    )
    expect(save).not.toHaveBeenCalled()
  })

  it('tries the offer once per session even if the save is rolled back', () => {
    const save = vi.fn()
    const settings = { visibleFields: ['title'], rekordboxPlaylistsFieldOffered: false } as Settings
    const { rerender } = renderHook(
      ({ current }) =>
        useOfferPlaylistFields(current, { rekordbox: true, traktor: false, engine: false }, save),
      {
        initialProps: { current: settings },
      },
    )
    rerender({ current: { ...settings } })
    rerender({ current: { ...settings } })
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe('the Traktor and Engine DJ playlists', () => {
  it('reads each library from its own app', async () => {
    const loadTraktorTree = vi.fn<Api['loadTraktorTree']>(async () => [
      { id: 'fri', name: 'Friday', kind: 'playlist', count: 1 },
    ])
    const engineMembership = vi.fn<Api['engineMembership']>(async () => ({ '/m/a.wav': ['7'] }))
    const traktorAvailable = vi.fn<Api['traktorAvailable']>(async () => true)
    installApi({ loadTraktorTree, engineMembership, traktorAvailable })
    const options = renderHook(() => useRekordboxPlaylistOptions(true, 'traktor'), { wrapper })
    const membership = renderHook(() => useRekordboxMembership(['/m/a.wav'], true, 'engine'), {
      wrapper,
    })
    const available = renderHook(() => useLibraryAvailable('traktor'), { wrapper })
    await waitFor(() =>
      expect(options.result.current).toEqual([{ id: 'fri', name: 'Friday', path: '' }]),
    )
    await waitFor(() => expect(membership.result.current).toEqual({ '/m/a.wav': ['7'] }))
    await waitFor(() => expect(available.result.current).toBe(true))
  })

  it('offers every library found in one save, so one offer never undoes another', () => {
    const save = vi.fn()
    const settings = {
      visibleFields: ['title'],
      rekordboxPlaylistsFieldOffered: true,
      traktorPlaylistsFieldOffered: false,
      enginePlaylistsFieldOffered: false,
    } as Settings
    renderHook(() =>
      useOfferPlaylistFields(settings, { rekordbox: true, traktor: true, engine: true }, save),
    )
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({
      visibleFields: ['title', 'traktorPlaylists', 'enginePlaylists'],
      traktorPlaylistsFieldOffered: true,
      enginePlaylistsFieldOffered: true,
    })
  })

  it('offers a library found later on its own, once', () => {
    const save = vi.fn()
    const settings = {
      visibleFields: ['title'],
      rekordboxPlaylistsFieldOffered: true,
      traktorPlaylistsFieldOffered: false,
      enginePlaylistsFieldOffered: false,
    } as Settings
    const { rerender } = renderHook(
      ({ engine }) =>
        useOfferPlaylistFields(settings, { rekordbox: false, traktor: false, engine }, save),
      { initialProps: { engine: false } },
    )
    expect(save).not.toHaveBeenCalled()
    rerender({ engine: true })
    rerender({ engine: true })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith({
      visibleFields: ['title', 'enginePlaylists'],
      enginePlaylistsFieldOffered: true,
    })
  })
})

describe('usePlaylistsSpec', () => {
  const fresh = { id: 't1', inputPath: '/m/new.flac', meta: {} } as TrackItem
  function spec(library: 'engine' | 'traktor') {
    installApi({
      engineAvailable: vi.fn<Api['engineAvailable']>(async () => true),
      traktorAvailable: vi.fn<Api['traktorAvailable']>(async () => true),
      traktorCanSave: vi.fn<Api['traktorCanSave']>(async () => true),
      loadEngineTree: vi.fn<Api['loadEngineTree']>(async () => [
        { id: '7', name: 'Friday', kind: 'playlist', count: 1 },
      ]),
      loadTraktorTree: vi.fn<Api['loadTraktorTree']>(async () => [
        { id: 'u1', name: 'Friday', kind: 'playlist', count: 1 },
      ]),
      engineMembership: vi.fn<Api['engineMembership']>(async () => ({})),
      traktorMembership: vi.fn<Api['traktorMembership']>(async () => ({})),
    })
    return renderHook(
      () =>
        usePlaylistsSpec(library, { shown: true, item: fresh, tracks: [fresh], onChange: vi.fn() }),
      { wrapper },
    )
  }

  it('lets a track Engine DJ does not have yet be sent to its playlists, since converting adds it to the collection', async () => {
    const hook = spec('engine')
    await waitFor(() => expect(hook.result.current).toBeDefined())
    expect(hook.result.current?.disabled).toBeUndefined()
  })
})
