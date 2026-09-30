// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackItem } from '../types'
import { useAppleMusicFill } from './useAppleMusicFill'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/m/a.wav',
    fileName: 'a.wav',
    listLabel: 'a',
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), title: 'Weekend (Extended)', artist: 'Tantra' },
    ...over,
  }
}

function setApi(appleMusicEntryMeta: ReturnType<typeof vi.fn<Api['appleMusicEntryMeta']>>): void {
  ;(window as unknown as { api: unknown }).api = { appleMusicEntryMeta }
}

afterEach(() => vi.restoreAllMocks())

describe('useAppleMusicFill', () => {
  it('asks Music about the matched entries and fills the gaps of the open track', async () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>().mockResolvedValue({ grouping: 'Bases' })
    setApi(entryMeta)
    const onChange = vi.fn()
    renderHook(() => useAppleMusicFill({ item: track(), candidates: ['PID1'], onChange }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(entryMeta).toHaveBeenCalledWith('/m/a.wav', ['PID1'])
    expect(onChange.mock.calls[0][0].meta.grouping).toBe('Bases')
  })

  it('fills on top of what the user typed while Music answered, not over it', async () => {
    let answer: (v: { grouping: string }) => void = () => {}
    const entryMeta = vi
      .fn<Api['appleMusicEntryMeta']>()
      .mockReturnValue(new Promise((resolve) => (answer = resolve)))
    setApi(entryMeta)
    const onChange = vi.fn()
    const { rerender } = renderHook(
      ({ item }) => useAppleMusicFill({ item, candidates: ['PID1'], onChange }),
      { initialProps: { item: track() } },
    )
    const typed = track({ meta: { ...track().meta, album: 'Weekend' } })
    rerender({ item: typed })
    answer({ grouping: 'Bases' })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({ album: 'Weekend', grouping: 'Bases' })
  })

  it('leaves a playlist import alone, which already filled from Music when it read the file', () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>()
    setApi(entryMeta)
    renderHook(() =>
      useAppleMusicFill({
        item: track({ fromAppleMusic: true }),
        candidates: ['PID1'],
        onChange: vi.fn(),
      }),
    )
    expect(entryMeta).not.toHaveBeenCalled()
  })

  it('waits for the file read, whose tags must be the ones the fill lands on', () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>()
    setApi(entryMeta)
    renderHook(() =>
      useAppleMusicFill({
        item: track({ loadingMeta: true }),
        candidates: ['PID1'],
        onChange: vi.fn(),
      }),
    )
    expect(entryMeta).not.toHaveBeenCalled()
  })

  it('asks nothing when the track matched no library entry', () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>()
    setApi(entryMeta)
    renderHook(() => useAppleMusicFill({ item: track(), candidates: [], onChange: vi.fn() }))
    expect(entryMeta).not.toHaveBeenCalled()
  })

  it('asks once per track, so typing in a field does not spawn osascript on every keystroke', async () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>().mockResolvedValue(null)
    setApi(entryMeta)
    const { rerender } = renderHook(
      ({ item }) => useAppleMusicFill({ item, candidates: ['PID1'], onChange: vi.fn() }),
      { initialProps: { item: track() } },
    )
    rerender({ item: track({ meta: { ...track().meta, album: 'W' } }) })
    rerender({ item: track({ meta: { ...track().meta, album: 'We' } }) })
    await waitFor(() => expect(entryMeta).toHaveBeenCalledTimes(1))
  })

  it('stays quiet when Music refuses, since the file already opened fine without it', async () => {
    const entryMeta = vi.fn<Api['appleMusicEntryMeta']>().mockRejectedValue(new Error('-1728'))
    setApi(entryMeta)
    const onChange = vi.fn()
    renderHook(() => useAppleMusicFill({ item: track(), candidates: ['PID1'], onChange }))
    await waitFor(() => expect(entryMeta).toHaveBeenCalled())
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
  })
})
