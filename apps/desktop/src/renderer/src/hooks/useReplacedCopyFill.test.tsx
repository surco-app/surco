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

function setApi(
  readTags: ReturnType<typeof vi.fn<Api['readTags']>>,
  readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(null),
): void {
  ;(window as unknown as { api: unknown }).api = { readTags, readCoverFull }
}

const COPY_COVER = 'data:image/jpeg;base64,QUJD'

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
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: false })
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

  it('takes the copy artwork when the new file has none, so the replacement keeps its cover', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({})), readCoverFull)
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
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(readCoverFull).toHaveBeenCalledWith('/old/your-love.mp3')
    expect(onChange.mock.calls[0][0]).toMatchObject({ coverUrl: COPY_COVER, copyFilled: true })
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: true })
  })

  it('keeps the artwork the new file already shows', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(
      vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })),
      readCoverFull,
    )
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'surco://cover/new.jpg' }),
        copyPath: '/old/your-love.mp3',
        onChange,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(readCoverFull).not.toHaveBeenCalled()
    expect(onChange.mock.calls[0][0].coverUrl).toBeUndefined()
  })

  it('leaves a cover the DJ removed by hand removed', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(
      vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })),
      readCoverFull,
    )
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverRemoved: true }),
        copyPath: '/old/your-love.mp3',
        onChange,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].coverUrl).toBeUndefined()
  })

  it('still fills the tags when the copy artwork cannot be read', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockRejectedValue(new Error('no art'))
    setApi(
      vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })),
      readCoverFull,
    )
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({ item: track(), copyPath: '/old/your-love.mp3', onChange }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({ meta: { album: 'Your Love' } })
    expect(onChange.mock.calls[0][0].coverUrl).toBeUndefined()
  })

  it('waits for the new file artwork to be read, so its own cover is never lost to the copy', () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>()
    const readTags = vi.fn<Api['readTags']>()
    setApi(readTags, readCoverFull)
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ metaPartial: true }),
        copyPath: '/old/your-love.mp3',
        onChange: vi.fn(),
      }),
    )
    expect(readTags).not.toHaveBeenCalled()
    expect(readCoverFull).not.toHaveBeenCalled()
  })

  it('fills only the fields still empty when the copy arrives after the DJ typed', async () => {
    setApi(
      vi
        .fn<Api['readTags']>()
        .mockResolvedValue(copyTags({ album: 'Your Love', genre: 'Euro House' })),
    )
    const order: string[] = []
    const onRecordUndo = vi.fn(() => order.push('undo'))
    const onChange = vi.fn((_patch: Partial<TrackItem>) => order.push('change'))
    const { rerender } = renderHook(
      ({ item, copyPath }) => useReplacedCopyFill({ item, copyPath, onChange, onRecordUndo }),
      { initialProps: { item: track(), copyPath: '' } },
    )
    const typed = track({ meta: { ...track().meta, album: 'Typed' } })
    rerender({ item: typed, copyPath: '' })
    rerender({ item: typed, copyPath: '/r/your-love.aiff' })

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({ album: 'Typed', genre: 'Euro House' })
    expect(order).toEqual(['undo', 'change'])
  })

  // A DJ copy's verdict arrives seconds later, so the DJ may already be on another track.
  it('drops a copy read that answers after the DJ moved to another track', async () => {
    let answerFirst: (v: TrackMetadata) => void = () => {}
    const readTags = vi
      .fn<Api['readTags']>()
      .mockReturnValueOnce(new Promise((resolve) => (answerFirst = resolve)))
      .mockResolvedValue(copyTags({}))
    setApi(readTags)
    const onChange = vi.fn()
    const { rerender } = renderHook(
      ({ item }) => useReplacedCopyFill({ item, copyPath: '/r/your-love.aiff', onChange }),
      { initialProps: { item: track() } },
    )
    rerender({ item: track({ id: 't2' }) })
    answerFirst(copyTags({ album: 'Your Love' }))
    await waitFor(() => expect(readTags).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onChange).toHaveBeenCalled())

    for (const [patch] of onChange.mock.calls) {
      expect(patch.meta?.album).not.toBe('Your Love')
    }
  })

  it('drops the old answer when the copy to fill from changes mid-read', async () => {
    const answers: Record<string, (v: TrackMetadata) => void> = {}
    const readTags = vi.fn<Api['readTags']>(
      (path) => new Promise((resolve) => (answers[path] = resolve)),
    )
    setApi(readTags)
    const onChange = vi.fn()
    const { rerender } = renderHook(
      ({ copyPath }) => useReplacedCopyFill({ item: track(), copyPath, onChange }),
      { initialProps: { copyPath: '/r/your-love.aiff' } },
    )
    rerender({ copyPath: '/m/old.mp3' })
    await waitFor(() => expect(readTags).toHaveBeenCalledTimes(2))
    answers['/r/your-love.aiff'](copyTags({ album: 'From R' }))
    await Promise.resolve()
    answers['/m/old.mp3'](copyTags({ album: 'From M' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0].meta).toMatchObject({ album: 'From M' })
  })
})
