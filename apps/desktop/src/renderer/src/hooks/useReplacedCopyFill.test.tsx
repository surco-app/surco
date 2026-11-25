// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
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

  // The copy's artwork is the one the DJ sees in their library for this track, so it wins over
  // the file's own or a match's. The file's art stays in the picker and ⌘Z takes it back.
  it('puts the copy artwork over the one the new file shows, with an undo step', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(
      vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })),
      readCoverFull,
    )
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({
          coverUrl: 'surco://cover/new.jpg',
          coverPath: '/covers/new.jpg',
          embeddedCover: 'surco://cover/new.jpg',
        }),
        copyPath: '/old/your-love.mp3',
        onChange,
        onRecordUndo,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(readCoverFull).toHaveBeenCalledWith('/old/your-love.mp3')
    expect(onChange.mock.calls[0][0]).toMatchObject({ coverUrl: COPY_COVER, coverPath: undefined })
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('embeddedCover')
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: true })
  })

  it('keeps the artwork the new file shows when the copy has none', async () => {
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })))
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'surco://cover/new.jpg' }),
        copyPath: '/old/your-love.mp3',
        onChange,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('coverUrl')
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
    expect(readCoverFull).not.toHaveBeenCalled()
    expect(onChange.mock.calls[0][0].coverUrl).toBeUndefined()
  })

  // Opening a track must never stage an edit by itself: the same picture coming back from the
  // copy changes nothing the DJ would see, so it leaves the cover and ⌘Z alone.
  it('leaves the file own cover alone when the copy carries the same picture', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({})), readCoverFull)
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'data:thumb', embeddedCover: 'data:thumb' }),
        copyPath: '/old/your-love.mp3',
        onChange,
        onRecordUndo,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ copyFilled: true }))
    expect(readCoverFull).toHaveBeenCalledWith('/new/your-love.aiff')
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  it('puts the copy picture over the file own cover when the two differ', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>((path) =>
      Promise.resolve(path === '/old/your-love.mp3' ? COPY_COVER : 'data:image/jpeg;base64,RklMRQ'),
    )
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({})), readCoverFull)
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'data:thumb', embeddedCover: 'data:thumb' }),
        copyPath: '/old/your-love.mp3',
        onChange,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({ coverUrl: COPY_COVER })
  })

  // Opening a track must never undo what the DJ chose: a cover picked by hand, even the file's
  // own picked back in the carousel, is their call, and the copy found later is not.
  it('keeps a cover the DJ picked by hand over the copy picture', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
    setApi(
      vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ album: 'Your Love' })),
      readCoverFull,
    )
    const onChange = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'blob:dropped', coverPath: '/img/dropped.png', coverPicked: true }),
        copyPath: '/old/your-love.mp3',
        onChange,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({ meta: { album: 'Your Love' } })
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('coverUrl')
  })

  it('keeps the file own cover the DJ picked back by hand over the copy picture', async () => {
    const readCoverFull = vi.fn<Api['readCoverFull']>((path) =>
      Promise.resolve(path === '/old/your-love.mp3' ? COPY_COVER : 'data:image/jpeg;base64,RklMRQ'),
    )
    setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({})), readCoverFull)
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track({ coverUrl: 'data:thumb', embeddedCover: 'data:thumb', coverPicked: true }),
        copyPath: '/old/your-love.mp3',
        onChange,
        onRecordUndo,
      }),
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ copyFilled: true }))
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  describe('from a copy that is another version', () => {
    // FLAC 6:01 against the MP3 5:57 in Apple Music and rekordbox: the MP3 carries the grouping
    // the DJ filed the track under, but its album and year are that other release's.
    it('lends only the grouping and the cover, never the other release album', async () => {
      const readCoverFull = vi.fn<Api['readCoverFull']>().mockResolvedValue(COPY_COVER)
      setApi(
        vi
          .fn<Api['readTags']>()
          .mockResolvedValue(
            copyTags({ grouping: 'Bases, Rockola', album: 'Other Release', year: '1999' }),
          ),
        readCoverFull,
      )
      const onChange = vi.fn()
      const onRecordUndo = vi.fn()
      renderHook(() =>
        useReplacedCopyFill({
          item: track({ coverUrl: 'surco://cover/new.jpg' }),
          copyPath: '/r/rockola.mp3',
          anotherVersion: true,
          onChange,
          onRecordUndo,
        }),
      )
      await waitFor(() => expect(onChange).toHaveBeenCalled())
      const patch = onChange.mock.calls[0][0]
      expect(patch).toMatchObject({
        meta: { grouping: 'Bases, Rockola', album: '', year: '' },
        coverUrl: COPY_COVER,
        copyFilled: true,
      })
      expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: true })
    })

    it('keeps the grouping the DJ already gave the track', async () => {
      setApi(vi.fn<Api['readTags']>().mockResolvedValue(copyTags({ grouping: 'Bases' })))
      const onChange = vi.fn()
      renderHook(() =>
        useReplacedCopyFill({
          item: track({ meta: { ...track().meta, grouping: 'Mine' } }),
          copyPath: '/r/rockola.mp3',
          anotherVersion: true,
          onChange,
        }),
      )
      await waitFor(() => expect(onChange).toHaveBeenCalledWith({ copyFilled: true }))
    })
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

// FLAC 7:01 against the WAV 7:06 in Apple Music: Music never writes tags into a WAV, so the
// grouping the DJ filed it under («Bases») and its artwork live only in Music's database.
describe('from the Apple Music copy that is another file', () => {
  const MUSIC_COVER = 'data:image/jpeg;base64,TVVTSUM'

  function setMusicApi(
    fileTags: Partial<TrackMetadata>,
    music: Awaited<ReturnType<Api['appleMusicEntryMeta']>> | Error,
    fileCover: string | null = null,
  ) {
    const api = {
      readTags: vi.fn<Api['readTags']>().mockResolvedValue(copyTags(fileTags)),
      readCoverFull: vi.fn<Api['readCoverFull']>((path) =>
        Promise.resolve(path === '/m/old/your-love.wav' ? fileCover : null),
      ),
      appleMusicEntryMeta: vi.fn<Api['appleMusicEntryMeta']>(() =>
        music instanceof Error ? Promise.reject(music) : Promise.resolve(music),
      ),
    }
    ;(window as unknown as { api: unknown }).api = api
    return api
  }

  function renderFill(over: Partial<TrackItem> = {}, anotherVersion = false) {
    const onChange = vi.fn()
    const onRecordUndo = vi.fn()
    renderHook(() =>
      useReplacedCopyFill({
        item: track(over),
        copyPath: '/m/old/your-love.wav',
        anotherVersion,
        musicEntry: 'PID1',
        onChange,
        onRecordUndo,
      }),
    )
    return { onChange, onRecordUndo }
  }

  // Main answers only the entry whose file is the path it is given, so asking with the open
  // file's path got nothing back for a copy that is another file.
  it("asks Music about the copy by the copy's own path", async () => {
    const api = setMusicApi({}, { grouping: 'Bases' })
    const { onChange } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(api.appleMusicEntryMeta).toHaveBeenCalledWith('/m/old/your-love.wav', ['PID1'])
  })

  it('lends only the grouping Music holds for another version, its year is another edit', async () => {
    setMusicApi({}, { grouping: 'Bases', year: '1999', comment: 'Otra' })
    const { onChange } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({
      grouping: 'Bases',
      year: '',
      comment: '',
    })
  })

  it('fills every field Music holds for a copy of the same recording, as for its own file', async () => {
    setMusicApi({ album: 'Your Love' }, { grouping: 'Bases', year: '1999', rating: 80 })
    const { onChange } = renderFill()
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({
      album: 'Your Love',
      grouping: 'Bases',
      year: '1999',
      rating: '4',
    })
  })

  // Both sources describe the same copy and may both carry the grouping. The copy's file is
  // what every other program reads, so it goes first and Music only fills what it leaves,
  // in one change and one undo step: two fills racing on one field would leave ⌘Z taking
  // back half of what opening the track did.
  it("lets the copy's file win over Music's database, in a single change and undo step", async () => {
    setMusicApi(
      { grouping: 'Bases, Rockola' },
      { grouping: 'Bases', coverUrl: MUSIC_COVER, coverPath: '/art/PID1.jpg' },
      COPY_COVER,
    )
    const { onChange, onRecordUndo } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onRecordUndo).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toMatchObject({
      meta: { grouping: 'Bases, Rockola' },
      coverUrl: COPY_COVER,
      coverPath: undefined,
    })
  })

  // Music's database art is its own re-encode of a picture, not the copy's file: the WAV case
  // put it over the open FLAC's own cover. It stands in only where the track shows none.
  it("keeps the file's own cover over Music's database artwork", async () => {
    setMusicApi({}, { grouping: 'Bases', coverUrl: MUSIC_COVER, coverPath: '/art/PID1.jpg' })
    const { onChange, onRecordUndo } = renderFill(
      { coverUrl: 'data:thumb', embeddedCover: 'data:thumb' },
      true,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({ meta: { grouping: 'Bases' } })
    expect(onChange.mock.calls[0][0]).not.toHaveProperty('coverUrl')
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: false })
  })

  it("takes Music's database artwork when the track shows no cover, with an undo step", async () => {
    setMusicApi({}, { grouping: 'Bases', coverUrl: MUSIC_COVER, coverPath: '/art/PID1.jpg' })
    const { onChange, onRecordUndo } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({
      coverUrl: MUSIC_COVER,
      coverPath: '/art/PID1.jpg',
    })
    expect(onRecordUndo).toHaveBeenCalledWith(['t1'], { cover: true })
  })

  it("leaves the cover alone when Music's artwork is the picture the track already shows", async () => {
    setMusicApi({}, { coverUrl: 'data:thumb', coverPath: '/art/PID1.jpg' })
    const { onChange, onRecordUndo } = renderFill(
      { coverUrl: 'data:thumb', embeddedCover: 'data:thumb' },
      true,
    )
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ copyFilled: true }))
    expect(onRecordUndo).not.toHaveBeenCalled()
  })

  it("never puts Music's artwork back over a cover the DJ removed by hand", async () => {
    setMusicApi({}, { grouping: 'Bases', coverUrl: MUSIC_COVER, coverPath: '/art/PID1.jpg' })
    const { onChange } = renderFill({ coverRemoved: true }, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].coverUrl).toBeUndefined()
  })

  it("still fills from the copy's file when Music does not answer", async () => {
    setMusicApi({ grouping: 'Bases, Rockola' }, new Error('Music is not running'))
    const { onChange } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0].meta).toMatchObject({ grouping: 'Bases, Rockola' })
  })

  // The copy's file may sit on a NAS that is asleep while Music still answers from its
  // database: the grouping Music holds is worth having without the file's.
  it("still lends Music's grouping when the copy's file cannot be read", async () => {
    const api = setMusicApi({}, { grouping: 'Bases' })
    api.readTags.mockRejectedValue(new Error('ENOENT'))
    const { onChange } = renderFill({}, true)
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange.mock.calls[0][0]).toMatchObject({
      meta: { grouping: 'Bases' },
      copyFilled: true,
    })
  })

  // A cold NAS fails the read once; marking the track filled then, now kept in the session,
  // would mean the copy's tags never get another try.
  it('leaves the track for another opening when the file cannot be read and Music lends nothing', async () => {
    const api = setMusicApi({}, { grouping: '' })
    api.readTags.mockRejectedValue(new Error('ENOENT'))
    const { onChange } = renderFill({}, true)
    await waitFor(() => expect(api.appleMusicEntryMeta).toHaveBeenCalled())
    await act(async () => {})
    expect(onChange).not.toHaveBeenCalled()
  })

  it('asks Music nothing for a copy that is not in Music', async () => {
    const api = setMusicApi({ grouping: 'Bases' }, null)
    const onChange = vi.fn()
    renderHook(() => useReplacedCopyFill({ item: track(), copyPath: '/r/your-love.wav', onChange }))
    await waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(api.appleMusicEntryMeta).not.toHaveBeenCalled()
  })
})
