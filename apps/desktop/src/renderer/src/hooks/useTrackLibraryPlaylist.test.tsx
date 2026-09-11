// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTrackLibrary } from './useTrackLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(over: Record<string, unknown> = {}): {
  result: { current: ReturnType<typeof useTrackLibrary> }
  onPlaylistImported: ReturnType<typeof vi.fn>
  expandPaths: ReturnType<typeof vi.fn>
} {
  const expandPaths = vi.fn((paths: string[]) => Promise.resolve(paths))
  ;(window as unknown as { api: unknown }).api = {
    takePendingFiles: vi.fn().mockResolvedValue([]),
    onOpenFiles: vi.fn(() => () => {}),
    onExpandedBatch: vi.fn(() => () => {}),
    onFoldersChanged: vi.fn(() => () => {}),
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    expandPaths,
    readMeta: vi.fn().mockResolvedValue({ tags: {}, duration: null, cover: null, foreignTags: [] }),
    recordStat: vi.fn(),
    loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({ paths: [], missing: 0 }),
    ...over,
  }
  const onPlaylistImported = vi.fn()
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped: vi.fn(),
      onNoAudioFound: vi.fn(),
      onMetaReadFailed: vi.fn(),
      onPlaylistImported,
    }),
  )
  return { result, onPlaylistImported, expandPaths }
}

describe('importing an Apple Music playlist', () => {
  it('loads the playlist files as ordinary tracks', async () => {
    const { result } = setup({
      loadAppleMusicPlaylistTracks: vi
        .fn()
        .mockResolvedValue({ paths: ['/m/a.aiff', '/m/b.flac'], missing: 0 }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Sesión sábado')
    })

    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff', '/m/b.flac'])
  })

  it('expands the playlist paths like any other import, so the same filters apply', async () => {
    // A playlist yields plain file paths, but they still go through expandPaths: it is
    // what strips the ._ AppleDouble companions and hidden entries a drop would lose.
    const { result, expandPaths } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({ paths: ['/m/a.aiff'], missing: 0 }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Sesión sábado')
    })

    expect(expandPaths).toHaveBeenCalledWith(['/m/a.aiff'])
  })

  it('reports how many tracks had no file, so a user who counts 128 in Music and sees 122 here is told why', async () => {
    // The whole reason the missing count is carried through the IPC. Without this the
    // gap is discovered by counting rows, which is what produces a bug report nobody
    // can reproduce.
    const { result, onPlaylistImported } = setup({
      loadAppleMusicPlaylistTracks: vi
        .fn()
        .mockResolvedValue({ paths: ['/m/a.aiff', '/m/b.flac'], missing: 6 }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Sesión sábado')
    })

    expect(onPlaylistImported).toHaveBeenCalledWith({
      name: 'Sesión sábado',
      imported: 2,
      missing: 6,
    })
  })

  it('still reports when the playlist held nothing importable at all', async () => {
    // An all-streaming playlist imports zero rows. Silence here would look like the
    // click did nothing.
    const { result, onPlaylistImported } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({ paths: [], missing: 12 }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Solo streaming')
    })

    expect(onPlaylistImported).toHaveBeenCalledWith({
      name: 'Solo streaming',
      imported: 0,
      missing: 12,
    })
  })
})
