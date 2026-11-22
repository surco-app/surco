// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionTrack, Settings } from '../../../shared/types'
import * as library from '../lib/appleMusicLibrary'
import { createQueryClient } from '../lib/queryClient'
import { SettingsProvider } from '../lib/settingsContext'
import { sourceCollectionOptions } from '../lib/sourcePrograms'
import { djReads, installApi } from '../test/api'
import { useProgramCopies } from './useProgramCopies'

const meta = { title: 'Weekend', artist: 'Tantra' }

const row = (path: string | null, over: Partial<CollectionTrack> = {}): CollectionTrack => ({
  contentId: path ?? 'x',
  path,
  ...meta,
  ...over,
})

function wrapperFor(
  settings: Partial<Settings>,
): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
  const client = createQueryClient()
  return ({ children }) => (
    <QueryClientProvider client={client}>
      <SettingsProvider settings={settings}>{children}</SettingsProvider>
    </QueryClientProvider>
  )
}

const args = (over: Partial<Parameters<typeof useProgramCopies>[0]> = {}) => ({
  inputPath: '/m/weekend.aiff',
  meta,
  enabled: true,
  ...over,
})

afterEach(() => vi.restoreAllMocks())

describe('useProgramCopies', () => {
  it('lists each enabled program that holds the track, in order', async () => {
    installApi({
      dj: djReads({
        virtualdj: { collection: async () => [row('/v/weekend.aiff')] },
        rekordbox: { collection: async () => [row('/r/weekend.aiff')] },
        serato: { collection: async () => [row('/s/other.aiff', { title: 'Other' })] },
      }),
    })
    const { result } = renderHook(() => useProgramCopies(args()), {
      wrapper: wrapperFor({ syncRekordbox: true, addToVirtualdj: true, syncSerato: true }),
    })
    await waitFor(() =>
      expect(result.current).toEqual([
        { program: 'rekordbox', path: '/r/weekend.aiff', isThisFile: false },
        { program: 'virtualdj', path: '/v/weekend.aiff', isThisFile: false },
      ]),
    )
  })

  it('does not read the collection of a program that is switched off', async () => {
    const traktor = vi.fn(async () => [row('/t/weekend.aiff')])
    const api = installApi({
      dj: djReads({
        traktor: { collection: traktor },
        rekordbox: { collection: async () => [row('/r/weekend.aiff')] },
      }),
    })
    const { result } = renderHook(() => useProgramCopies(args()), {
      wrapper: wrapperFor({ syncRekordbox: true }),
    })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(traktor).not.toHaveBeenCalled()
    expect(api.dj.collection).not.toHaveBeenCalledWith('traktor')
  })

  it('shows no row for a switched-off program even when its collection is cached', async () => {
    installApi({ dj: djReads({ traktor: { collection: async () => [row('/t/weekend.aiff')] } }) })
    const client = createQueryClient()
    await client.prefetchQuery(sourceCollectionOptions('traktor'))
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <SettingsProvider settings={{ syncRekordbox: true }}>{children}</SettingsProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useProgramCopies(args()), { wrapper })
    await Promise.resolve()
    expect(result.current).toEqual([])
  })

  it('does not read anything while disabled', async () => {
    const rekordbox = vi.fn(async () => [row('/r/weekend.aiff')])
    installApi({ dj: djReads({ rekordbox: { collection: rekordbox } }) })
    const { result } = renderHook(() => useProgramCopies(args({ enabled: false })), {
      wrapper: wrapperFor({ syncRekordbox: true }),
    })
    await Promise.resolve()
    expect(result.current).toEqual([])
    expect(rekordbox).not.toHaveBeenCalled()
  })

  it('shows no copy for a program whose collection fails to read', async () => {
    installApi({
      dj: djReads({
        rekordbox: {
          collection: async () => {
            throw new Error('locked')
          },
        },
        traktor: { collection: async () => [row('/t/weekend.aiff')] },
      }),
    })
    const { result } = renderHook(() => useProgramCopies(args()), {
      wrapper: wrapperFor({ syncRekordbox: true, syncTraktor: true }),
    })
    await waitFor(() =>
      expect(result.current).toEqual([
        { program: 'traktor', path: '/t/weekend.aiff', isThisFile: false },
      ]),
    )
  })

  it('marks the copy that is this very file', async () => {
    const nfd = '/m/Café.aiff'
    const nfc = '/m/Café.aiff'
    installApi({
      dj: djReads({
        rekordbox: { collection: async () => [row(nfd)] },
        traktor: { collection: async () => [row('/t/weekend.aiff')] },
      }),
    })
    const { result } = renderHook(() => useProgramCopies(args({ inputPath: nfc })), {
      wrapper: wrapperFor({ syncRekordbox: true, syncTraktor: true }),
    })
    await waitFor(() =>
      expect(result.current.map((c) => [c.program, c.isThisFile])).toEqual([
        ['rekordbox', true],
        ['traktor', false],
      ]),
    )
  })

  it('falls back to the suggested tags', async () => {
    installApi({
      dj: djReads({
        rekordbox: {
          collection: async () => [row('/r/x.aiff', { title: 'Weekend (Extended)' })],
        },
      }),
    })
    const { result } = renderHook(
      () =>
        useProgramCopies(
          args({
            meta: { title: 'wk', artist: 'unknown' },
            suggestedMeta: { title: 'Weekend (Extended)', artist: 'Tantra' },
          }),
        ),
      { wrapper: wrapperFor({ syncRekordbox: true }) },
    )
    await waitFor(() => expect(result.current).toHaveLength(1))
  })

  it('builds each index once per collection', async () => {
    const build = vi.spyOn(library, 'buildLibraryIndex')
    installApi({
      dj: djReads({
        rekordbox: { collection: async () => [row('/r/weekend.aiff')] },
        traktor: { collection: async () => [row('/t/weekend.aiff')] },
      }),
    })
    const { result, rerender } = renderHook(() => useProgramCopies(args()), {
      wrapper: wrapperFor({ syncRekordbox: true, syncTraktor: true }),
    })
    await waitFor(() => expect(result.current).toHaveLength(2))
    const calls = build.mock.calls.length
    rerender()
    rerender()
    expect(build.mock.calls.length).toBe(calls)
    expect(calls).toBe(2)
  })

  it('does not rebuild the index when the editor opens the next track', async () => {
    const build = vi.spyOn(library, 'buildLibraryIndex')
    installApi({
      dj: djReads({ rekordbox: { collection: async () => [row('/r/weekend.aiff')] } }),
    })
    const wrapper = wrapperFor({ syncRekordbox: true })
    const first = renderHook(() => useProgramCopies(args()), { wrapper })
    await waitFor(() => expect(first.result.current).toHaveLength(1))
    first.unmount()
    expect(build).toHaveBeenCalledTimes(1)
    const second = renderHook(() => useProgramCopies(args()), { wrapper })
    await waitFor(() => expect(second.result.current).toHaveLength(1))
    expect(build).toHaveBeenCalledTimes(1)
  })

  it('does not rebuild a program index when another program arrives later', async () => {
    const build = vi.spyOn(library, 'buildLibraryIndex')
    let releaseTraktor: () => void = () => {}
    const traktorReady = new Promise<void>((resolve) => {
      releaseTraktor = resolve
    })
    installApi({
      dj: djReads({
        rekordbox: { collection: async () => [row('/r/weekend.aiff')] },
        traktor: {
          collection: async () => {
            await traktorReady
            return [row('/t/weekend.aiff')]
          },
        },
      }),
    })
    const { result } = renderHook(() => useProgramCopies(args()), {
      wrapper: wrapperFor({ syncRekordbox: true, syncTraktor: true }),
    })
    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(build).toHaveBeenCalledTimes(1)
    releaseTraktor()
    await waitFor(() => expect(result.current).toHaveLength(2))
    expect(build).toHaveBeenCalledTimes(2)
  })
})
