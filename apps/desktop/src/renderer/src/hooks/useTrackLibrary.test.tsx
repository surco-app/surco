// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTrackLibrary } from './useTrackLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

type FoldersChangedCb = (root: string, files: string[]) => void

function setApi(over: Record<string, unknown> = {}): { fire: FoldersChangedCb } {
  let cb: FoldersChangedCb = () => {}
  ;(window as unknown as { api: unknown }).api = {
    takePendingFiles: vi.fn().mockResolvedValue([]),
    onOpenFiles: vi.fn(() => () => {}),
    onFoldersChanged: vi.fn((fn: FoldersChangedCb) => {
      cb = fn
      return () => {}
    }),
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    expandPaths: vi.fn().mockResolvedValue([]),
    ...over,
  }
  return { fire: (root, files) => cb(root, files) }
}

function setup(): {
  result: { current: ReturnType<typeof useTrackLibrary> }
  fire: FoldersChangedCb
} {
  const { fire } = setApi()
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped: vi.fn(),
      onMetaReadFailed: vi.fn(),
    }),
  )
  return { result, fire }
}

describe('useTrackLibrary watched folders', () => {
  // The watcher exists to detect tracks copied into a folder the crate was loaded FROM.
  // On macOS closing the window does not quit the app, so a watch from a prior session can
  // outlive its crate; when the reopened window's list starts empty, a fired watch would
  // otherwise diff the folder's whole contents against nothing and flag every file as "new".
  // An empty crate has no loaded folder to grow, so the prompt must not appear.
  it('ignores a watched-folder change while the crate is empty', () => {
    const { result, fire } = setup()

    act(() => fire('/music/oldcrate', ['/music/oldcrate/a.flac', '/music/oldcrate/b.wav']))

    expect(result.current.pendingNew).toBeNull()
  })

  // The stale watch that fired against the empty list is still holding OS resources (and a
  // 60s poll); releasing it on the first empty-crate event stops it re-firing every minute.
  it('releases the orphaned watch when a change arrives with an empty crate', () => {
    const unwatchFolders = vi.fn().mockResolvedValue(undefined)
    const { fire } = setApi({ unwatchFolders })
    renderHook(() =>
      useTrackLibrary({
        setSelection: vi.fn(),
        onForget: vi.fn(),
        onRemove: vi.fn(),
        onClear: vi.fn(),
        onMetaLoaded: vi.fn(),
        onDuplicatesSkipped: vi.fn(),
        onMetaReadFailed: vi.fn(),
      }),
    )

    act(() => fire('/music/oldcrate', ['/music/oldcrate/a.flac']))

    expect(unwatchFolders).toHaveBeenCalledTimes(1)
  })
})

describe('useTrackLibrary meta read failures', () => {
  // A file whose tags can't be read still gets a row (parsed from its name), but the user
  // must be told the difference between "this file has no tags" and "the read failed" —
  // otherwise a corrupt or locked file quietly shows degraded data and gets tagged from
  // scratch when its real metadata was there all along.
  it('flags the track and reports the count when a batch finishes with failed reads', async () => {
    const onMetaReadFailed = vi.fn()
    setApi({
      readMeta: vi.fn((path: string) =>
        path.includes('broken')
          ? Promise.reject(new Error('EACCES'))
          : Promise.resolve({ tags: { title: 'Fine', artist: 'A' }, duration: 180, cover: null }),
      ),
    })
    const { result } = renderHook(() =>
      useTrackLibrary({
        setSelection: vi.fn(),
        onForget: vi.fn(),
        onRemove: vi.fn(),
        onClear: vi.fn(),
        onMetaLoaded: vi.fn(),
        onDuplicatesSkipped: vi.fn(),
        onMetaReadFailed,
      }),
    )
    await act(() => result.current.addPaths(['/music/broken.wav', '/music/fine.wav']))

    const broken = result.current.tracks.find((t) => t.fileName.includes('broken'))
    const fine = result.current.tracks.find((t) => t.fileName.includes('fine'))
    expect(broken?.metaReadFailed).toBe(true)
    expect(broken?.loadingMeta).toBe(false)
    expect(fine?.metaReadFailed).toBeUndefined()
    expect(onMetaReadFailed).toHaveBeenCalledExactlyOnceWith(1)
  })

  // A clean import must stay quiet — the aggregate notice exists for failures only, and a
  // second import's counter must not inherit the first one's failures.
  it('reports nothing for a clean batch and resets the count between batches', async () => {
    const onMetaReadFailed = vi.fn()
    let fail = true
    setApi({
      readMeta: vi.fn(() =>
        fail
          ? Promise.reject(new Error('EIO'))
          : Promise.resolve({ tags: { title: '', artist: '' }, duration: 180, cover: null }),
      ),
    })
    const { result } = renderHook(() =>
      useTrackLibrary({
        setSelection: vi.fn(),
        onForget: vi.fn(),
        onRemove: vi.fn(),
        onClear: vi.fn(),
        onMetaLoaded: vi.fn(),
        onDuplicatesSkipped: vi.fn(),
        onMetaReadFailed,
      }),
    )
    await act(() => result.current.addPaths(['/music/one.wav']))
    expect(onMetaReadFailed).toHaveBeenCalledExactlyOnceWith(1)

    fail = false
    await act(() => result.current.addPaths(['/music/two.wav']))
    expect(onMetaReadFailed).toHaveBeenCalledTimes(1)
  })
})
