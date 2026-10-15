// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import { trackSignature } from '../lib/dirty'
import { useTrackLibrary } from './useTrackLibrary'

// readMeta resolves the whole tag shape in the real app; a partial object makes
// searchFromTags throw and the row silently falls back to its file-name parse.
function tags(over: Partial<TrackMetadata> = {}): TrackMetadata {
  return { ...emptyMetadata(), ...over }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function setup(
  over: Record<string, unknown> = {},
  opts: Record<string, unknown> = {},
): {
  result: { current: ReturnType<typeof useTrackLibrary> }
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
    loadAppleMusicPlaylistTracks: vi
      .fn()
      .mockResolvedValue({ paths: [], persistentIds: {}, missing: 0 }),
    ...over,
  }
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
      ...opts,
    }),
  )
  return { result, expandPaths }
}

describe('opening a source playlist', () => {
  const entries = (paths: string[]) => paths.map((path) => ({ path, separator: false, meta: {} }))

  it('loads the playlist files and leaves separators and file-less rows out', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(
        [
          ...entries(['/m/a.aiff']),
          { path: '/m/_.mp3', separator: true, meta: {} },
          { path: null, separator: false, meta: {} },
        ],
        'rekordbox',
      )
    })
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff'])
  })

  it('does not report already-loaded tracks as skipped: browsing back to a playlist is not a re-import', async () => {
    const onDuplicatesSkipped = vi.fn()
    const { result } = setup({}, { onDuplicatesSkipped })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
    })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
    })
    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff', '/m/b.aiff'])
  })

  it('does not report as skipped what an overlapping open of the same playlist just added', async () => {
    const pending: Array<() => void> = []
    const expandPaths = vi.fn(
      (paths: string[]) => new Promise<string[]>((resolve) => pending.push(() => resolve(paths))),
    )
    const onDuplicatesSkipped = vi.fn()
    const { result } = setup({ expandPaths }, { onDuplicatesSkipped })
    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
      second = result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
    })
    await act(async () => {
      for (const resolve of pending) resolve()
      await Promise.all([first, second])
    })
    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff', '/m/b.aiff'])
  })

  it('fills bpm and key from rekordbox when the file has none', async () => {
    const { result } = setup({
      readMeta: vi.fn().mockResolvedValue({
        tags: tags({ title: 'Night Train' }),
        duration: 256,
        cover: null,
        foreignTags: [],
      }),
    })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: { bpm: '150', key: '4B' } }],
        'rekordbox',
      )
    })
    await waitFor(() => expect(result.current.tracks[0].meta.key).toBe('4B'))
    expect(result.current.tracks[0].meta.bpm).toBe('150')
  })

  it('still fills bpm and key when the expand stream creates the row before expandPaths returns', async () => {
    let streamed: (paths: string[]) => void = () => {}
    const readMeta = vi.fn().mockResolvedValue({
      tags: tags({ title: 'Night Train' }),
      duration: 256,
      cover: null,
      foreignTags: [],
    })
    const { result } = setup({
      onExpandedBatch: vi.fn((cb: (paths: string[]) => void) => {
        streamed = cb
        return () => {}
      }),
      expandPaths: vi.fn(async (paths: string[]) => {
        streamed(paths)
        await Promise.resolve()
        return paths
      }),
      readMeta,
    })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: { bpm: '150', key: '4B' } }],
        'rekordbox',
      )
    })
    await waitFor(() => expect(result.current.tracks[0].meta.key).toBe('4B'))
    expect(result.current.tracks[0].meta.bpm).toBe('150')
  })

  it('does not leak the playlist bpm and key into a later plain load of a path expandPaths dropped', async () => {
    const readMeta = vi.fn().mockResolvedValue({
      tags: tags({ title: 'Night Train' }),
      duration: 256,
      cover: null,
      foreignTags: [],
    })
    const expandPaths = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation((paths: string[]) => Promise.resolve(paths))
    const { result } = setup({ expandPaths, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: { bpm: '150', key: '4B' } }],
        'rekordbox',
      )
    })
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    await waitFor(() => expect(result.current.tracks).toHaveLength(1))
    await waitFor(() => expect(readMeta).toHaveBeenCalled())
    expect(result.current.tracks[0].meta.key).not.toBe('4B')
  })

  it('stamps a Music row with its library identity, so converting updates that copy', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(
        [
          {
            path: '/m/a.aiff',
            separator: false,
            meta: {},
            musicPersistentId: 'PID0000000000001',
          },
        ],
        'appleMusic',
      )
    })
    expect(result.current.tracks[0]).toMatchObject({
      fromAppleMusic: true,
      musicPersistentId: 'PID0000000000001',
    })
  })

  it('expands the Music paths like any other load, so the same filters apply', async () => {
    const { result, expandPaths } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'appleMusic')
    })
    expect(expandPaths).toHaveBeenCalledWith(['/m/a.aiff'])
  })

  it('gives a Music track with no library identity none, rather than a neighbour’s', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(
        [
          { path: '/m/a.aiff', separator: false, meta: {}, musicPersistentId: 'PID0000000000001' },
          { path: '/m/b.flac', separator: false, meta: {} },
        ],
        'appleMusic',
      )
    })
    const [a, b] = result.current.tracks
    expect(a.musicPersistentId).toBe('PID0000000000001')
    expect(b.musicPersistentId).toBeUndefined()
  })

  it('marks Music rows even when the expand stream creates them first', async () => {
    let fire: ((paths: string[]) => void) | undefined
    const { result } = setup({
      onExpandedBatch: vi.fn((cb: (paths: string[]) => void) => {
        fire = cb
        return () => {}
      }),
      expandPaths: vi.fn(async (paths: string[]) => {
        fire?.(paths)
        return paths
      }),
    })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.wav', separator: false, meta: {}, musicPersistentId: 'PID0000000000001' }],
        'appleMusic',
      )
    })
    expect(result.current.tracks).toHaveLength(1)
    expect(result.current.tracks[0].fromAppleMusic).toBe(true)
    expect(result.current.tracks[0].musicPersistentId).toBe('PID0000000000001')
  })

  const musicReadMeta = (over: Partial<TrackMetadata>) =>
    vi.fn().mockResolvedValue({
      tags: tags({ title: 'Tahikiry', ...over }),
      duration: 376,
      cover: null,
      foreignTags: [],
    })

  it('fills the editor with what Music knows and the file does not', async () => {
    const { result } = setup({ readMeta: musicReadMeta({}) })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.wav', separator: false, meta: { grouping: 'Bases, Chocolate', year: '2020' } }],
        'appleMusic',
      )
    })
    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    expect(result.current.tracks[0].meta.grouping).toBe('Bases, Chocolate')
    expect(result.current.tracks[0].meta.year).toBe('2020')
  })

  it('lets the file win over Music, because the file is what other tools read', async () => {
    const { result } = setup({ readMeta: musicReadMeta({ year: '1995' }) })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.wav', separator: false, meta: { year: '2020' } }],
        'appleMusic',
      )
    })
    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    expect(result.current.tracks[0].meta.year).toBe('1995')
  })

  it('counts what Music filled in as the file’s own state, not as a pending edit', async () => {
    const { result } = setup({ readMeta: musicReadMeta({}) })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.wav', separator: false, meta: { grouping: 'Bases' } }],
        'appleMusic',
      )
    })
    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    const t = result.current.tracks[0]
    expect(t.diskSignature).toBe(trackSignature({ meta: t.meta }))
  })
})
