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
import type { TrackItem } from '../types'
import { sameLengthCopyIn, useProgramCopies, useSelectionCopies } from './useProgramCopies'

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

  it('lists no copy while disabled even when the program tab already cached its collection', async () => {
    installApi({ dj: djReads({ rekordbox: { collection: async () => [row('/r/weekend.aiff')] } }) })
    const client = createQueryClient()
    await client.prefetchQuery(sourceCollectionOptions('rekordbox'))
    const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
      <QueryClientProvider client={client}>
        <SettingsProvider settings={{ syncRekordbox: true }}>{children}</SettingsProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useProgramCopies(args({ enabled: false })), { wrapper })
    await Promise.resolve()
    expect(result.current).toEqual([])
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

  // 3 Ways: the program's copy runs 35 s shorter, another edit of the same title. Apple
  // Music shows such a copy and now describes it; a program row must too, so the section
  // reads the same whichever library holds it.
  it('lists a copy of the same title and artist whose length is far from this file', async () => {
    installApi({
      dj: djReads({
        rekordbox: {
          collection: async () => [
            row('/r/real-love.wav', {
              title: 'Real Love (Extended Version)',
              artist: '3 Ways',
              durationSec: 447.9,
            }),
          ],
        },
      }),
    })
    const { result } = renderHook(
      () =>
        useProgramCopies(
          args({
            meta: { title: 'Real love (EXTENDED REMASTERED)', artist: '3 WAYS' },
            durationSec: 483.4,
          }),
        ),
      { wrapper: wrapperFor({ syncRekordbox: true }) },
    )
    await waitFor(() =>
      expect(result.current).toEqual([
        { program: 'rekordbox', path: '/r/real-love.wav', isThisFile: false },
      ]),
    )
  })

  // A match without the length is the last resort: a suggested release confirmed by the
  // length is the better evidence of which copy this is.
  it('prefers the suggested tags confirmed by length over its own tags without length', async () => {
    installApi({
      dj: djReads({
        rekordbox: {
          collection: async () => [
            row('/r/edit.wav', {
              title: 'Real Love (Extended Version)',
              artist: '3 Ways',
              durationSec: 447.9,
            }),
            row('/r/same.wav', { title: 'Amor Real', artist: 'Tres Vías', durationSec: 483.4 }),
          ],
        },
      }),
    })
    const { result } = renderHook(
      () =>
        useProgramCopies(
          args({
            meta: { title: 'Real love (EXTENDED REMASTERED)', artist: '3 WAYS' },
            durationSec: 483.4,
            suggestedMeta: { title: 'Amor Real', artist: 'Tres Vías' },
          }),
        ),
      { wrapper: wrapperFor({ syncRekordbox: true }) },
    )
    await waitFor(() =>
      expect(result.current).toEqual([
        { program: 'rekordbox', path: '/r/same.wav', isThisFile: false },
      ]),
    )
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

  it('shows this very file when the collection also holds a newer copy of the same recording', async () => {
    installApi({
      dj: djReads({
        rekordbox: {
          collection: async () => [
            row('/r/Weekend.aiff', { durationSec: 361 }),
            row('/r/Weekend.mp3', { durationSec: 361 }),
          ],
        },
      }),
    })
    const { result } = renderHook(
      () => useProgramCopies(args({ inputPath: '/R/weekend.mp3', durationSec: 361 })),
      { wrapper: wrapperFor({ syncRekordbox: true }) },
    )
    await waitFor(() =>
      expect(result.current).toEqual([
        { program: 'rekordbox', path: '/R/weekend.mp3', isThisFile: true },
      ]),
    )
  })
})

// A selection has no section to compare audio, so only an entry of the same title, artist
// and length counts as the track's copy; filing another edit of it in a set would be wrong.
describe('sameLengthCopyIn', () => {
  const selected = { inputPath: '/m/weekend.flac', meta, durationSec: 361 }

  it('finds a copy of the same length for a selected track', () => {
    expect(sameLengthCopyIn([row('/r/weekend.aiff', { durationSec: 361 })], selected)).toBe(
      '/r/weekend.aiff',
    )
  })

  it('takes no copy of another length in a selection, since there is no comparison to tell another version apart', () => {
    expect(
      sameLengthCopyIn([row('/r/weekend.aiff', { durationSec: 300 })], selected),
    ).toBeUndefined()
  })

  it('takes no copy without a known length', () => {
    expect(
      sameLengthCopyIn([row('/r/weekend.aiff', { durationSec: 361 })], {
        ...selected,
        durationSec: undefined,
      }),
    ).toBeUndefined()
  })

  it('takes the track itself as no copy, since there is nothing else to file', () => {
    expect(
      sameLengthCopyIn([row('/m/weekend.flac', { durationSec: 361 })], selected),
    ).toBeUndefined()
  })
})

describe('useSelectionCopies', () => {
  const selected = (id: string, title: string): TrackItem =>
    ({
      id,
      inputPath: `/m/${id}.flac`,
      duration: 361,
      meta: { title, artist: 'Tantra' },
    }) as TrackItem

  it('maps each selected track to its copy in each enabled program', async () => {
    installApi({
      dj: djReads({
        rekordbox: { collection: async () => [row('/r/weekend.aiff', { durationSec: 361 })] },
        traktor: { collection: async () => [row('/t/weekend.aiff', { durationSec: 361 })] },
      }),
    })
    const tracks = [selected('a', 'Weekend'), selected('b', 'Hills')]
    const { result } = renderHook(() => useSelectionCopies(tracks, true), {
      wrapper: wrapperFor({ syncRekordbox: true }),
    })
    await waitFor(() => expect(result.current).toEqual({ rekordbox: { a: '/r/weekend.aiff' } }))
  })

  it('does not look a track up again on a progress tick, which hands over a new array of the same tracks', async () => {
    installApi({
      dj: djReads({
        rekordbox: { collection: async () => [row('/r/weekend.aiff', { durationSec: 361 })] },
      }),
    })
    const lookup = vi.spyOn(library, 'findLibraryEntry')
    const { result, rerender } = renderHook(
      ({ tracks }: { tracks: TrackItem[] }) => useSelectionCopies(tracks, true),
      {
        wrapper: wrapperFor({ syncRekordbox: true }),
        initialProps: { tracks: [selected('a', 'Weekend'), selected('b', 'Hills')] },
      },
    )
    await waitFor(() => expect(result.current).toEqual({ rekordbox: { a: '/r/weekend.aiff' } }))
    const calls = lookup.mock.calls.length
    rerender({ tracks: [selected('a', 'Weekend'), selected('b', 'Hills')] })
    expect(result.current).toEqual({ rekordbox: { a: '/r/weekend.aiff' } })
    expect(lookup.mock.calls.length).toBe(calls)
    rerender({ tracks: [selected('a', 'Weekend'), selected('b', 'Hills'), selected('c', 'Sun')] })
    expect(lookup.mock.calls.length).toBe(calls + 1)
  })

  it('reads nothing while disabled', async () => {
    const rekordbox = vi.fn(async () => [row('/r/weekend.aiff', { durationSec: 361 })])
    installApi({ dj: djReads({ rekordbox: { collection: rekordbox } }) })
    const { result } = renderHook(() => useSelectionCopies([selected('a', 'Weekend')], false), {
      wrapper: wrapperFor({ syncRekordbox: true }),
    })
    await Promise.resolve()
    expect(result.current).toEqual({})
    expect(rekordbox).not.toHaveBeenCalled()
  })
})
