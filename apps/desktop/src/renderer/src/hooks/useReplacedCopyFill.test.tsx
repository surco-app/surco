// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { useReplacedCopyFill } from './useReplacedCopyFill'

function track(over: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 't1',
    inputPath: '/new/your-love.aiff',
    fileName: 'your-love.aiff',
    listLabel: 'Your Love',
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), title: 'Your Love (Power Love Mix)', artist: '2 Shy' },
    ...over,
  }
}

const copyTags = (fields: Partial<TrackMetadata>): TrackMetadata => ({
  ...emptyMetadata(),
  ...fields,
})

function setApi(readTags: ReturnType<typeof vi.fn<Api['readTags']>>): void {
  ;(window as unknown as { api: unknown }).api = { readTags }
}

afterEach(() => vi.restoreAllMocks())

describe('useReplacedCopyFill', () => {
  it('fills the gaps from the library copy so the replacement needs no retyping', async () => {
    const readTags = vi
      .fn<Api['readTags']>()
      .mockResolvedValue(
        copyTags({ album: 'Your Love', genre: 'Euro House', grouping: 'Cantaditas' }),
      )
    setApi(readTags)
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({ item: track(), copyPath: '/old/your-love.mp3', onChange }),
    )

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(readTags).toHaveBeenCalledWith('/old/your-love.mp3')
    expect(onChange.mock.calls[0][0]).toMatchObject({
      copyFilled: true,
      meta: { album: 'Your Love', genre: 'Euro House', grouping: 'Cantaditas' },
    })
  })

  it('records an undo step first, so ⌘Z takes the fill back', async () => {
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })))
    const order: string[] = []
    const onRecordUndo = vi.fn(() => order.push('undo'))
    const onChange = vi.fn(() => order.push('change'))
    renderHook(() =>
      useReplacedCopyFill({
        item: track(),
        copyPath: '/old/your-love.mp3',
        onChange,
        onRecordUndo,
      }),
    )

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'])
    expect(order).toEqual(['undo', 'change'])
  })

  it('fills on top of what the DJ typed while the copy was being read', async () => {
    let answer: (v: TrackMetadata) => void = () => {}
    setApi(vi.fn<Api['readTags']>().mockReturnValue(new Promise((resolve) => (answer = resolve))))
    const onChange = vi.fn()
    const { rerender } = renderHook(
      ({ item }) => useReplacedCopyFill({ item, copyPath: '/old/your-love.mp3', onChange }),
      { initialProps: { item: track() } },
    )
    rerender({ item: track({ meta: { ...track().meta, album: 'Typed' } }) })
    answer(copyTags({ album: 'Your Love', genre: 'Euro House' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({ album: 'Typed', genre: 'Euro House' })
  })

  it('fills once per track, so a field the DJ cleared stays cleared on the next visit', () => {
    const readTags = vi.fn<Api['readTags']>()
    setApi(readTags)
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ copyFilled: true }),
        copyPath: '/old/your-love.mp3',
        onChange: vi.fn(),
      }),
    )
    expect(readTags).not.toHaveBeenCalled()
  })

  it('reads once while the DJ types, not on every keystroke', async () => {
    const readTags = vi.fn<Api['readTags']>().mockResolvedValue(copyTags({}))
    setApi(readTags)
    const { rerender } = renderHook(
      ({ item }) =>
        useReplacedCopyFill({ item, copyPath: '/old/your-love.mp3', onChange: vi.fn() }),
      { initialProps: { item: track() } },
    )
    rerender({ item: track({ meta: { ...track().meta, album: 'Y' } }) })
    rerender({ item: track({ meta: { ...track().meta, album: 'Yo' } }) })
    await waitFor(() => expect(readTags).toHaveBeenCalledTimes(1))
  })

  it('reads nothing until the library copy has a located file', () => {
    const readTags = vi.fn<Api['readTags']>()
    setApi(readTags)
    renderHook(() => useReplacedCopyFill({ item: track(), copyPath: '', onChange: vi.fn() }))
    expect(readTags).not.toHaveBeenCalled()
  })

  it('waits for the open file own tags, which are the ones the fill must respect', () => {
    const readTags = vi.fn<Api['readTags']>()
    setApi(readTags)
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ loadingMeta: true }),
        copyPath: '/old/your-love.mp3',
        onChange: vi.fn(),
      }),
    )
    expect(readTags).not.toHaveBeenCalled()
  })

  it('never fills after Clear all, whose promise is a file that comes out empty', () => {
    const readTags = vi.fn<Api['readTags']>()
    setApi(readTags)
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ metaCleared: true }),
        copyPath: '/old/your-love.mp3',
        onChange: vi.fn(),
      }),
    )
    expect(readTags).not.toHaveBeenCalled()
  })

  it('marks the track without an undo step when the copy adds nothing', async () => {
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({})))
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track(),
        copyPath: '/old/your-love.mp3',
        onChange,
        onRecordUndo,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ copyFilled: true }))
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  it('stays quiet when the copy cannot be read, the replacement still works without it', async () => {
    const readTags = vi.fn<Api['readTags']>().mockRejectedValue(new Error('ENOENT'))
    setApi(readTags)
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({ item: track(), copyPath: '/old/your-love.mp3', onChange }),
    )
    await waitFor(() => expect(readTags).toHaveBeenCalled())
    await Promise.resolve()
    expect(onChange).not.toHaveBeenCalled()
  })
})
