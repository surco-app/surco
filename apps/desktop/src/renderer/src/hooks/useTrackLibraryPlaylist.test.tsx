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
    loadAppleMusicPlaylistTracks: vi
      .fn()
      .mockResolvedValue({ paths: [], persistentIds: {}, missing: 0 }),
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
        .mockResolvedValue({ paths: ['/m/a.aiff', '/m/b.flac'], persistentIds: {}, missing: 0 }),
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
      loadAppleMusicPlaylistTracks: vi
        .fn()
        .mockResolvedValue({ paths: ['/m/a.aiff'], persistentIds: {}, missing: 0 }),
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
        .mockResolvedValue({ paths: ['/m/a.aiff', '/m/b.flac'], persistentIds: {}, missing: 6 }),
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

  it('stamps each row with the Music entry it came from, so converting updates that copy instead of adding a second one', async () => {
    // The conversion's Apple Music step keys off musicPersistentId: with it, the library
    // entry the track came from is updated in place. Without it, Surco treats the file as
    // one it has never seen and the song ends up in the library twice.
    const { result } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.aiff', '/m/b.flac'],
        persistentIds: { '/m/a.aiff': 'A1B2C3D4E5F60718' },
        missing: 0,
      }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Sesión sábado')
    })

    const [a, b] = result.current.tracks
    expect(a.musicPersistentId).toBe('A1B2C3D4E5F60718')
    // A track Music gave no ID for carries none, rather than inheriting a neighbour's.
    expect(b.musicPersistentId).toBeUndefined()
  })

  it('marks the rows even when the expand stream creates them first', async () => {
    // Measured in the real app: the rows the import creates come from onExpandedBatch,
    // which fires with the same paths BEFORE the awaited expandPaths resolves. The later
    // call then dedupes against rows that already exist, so a seed passed only to it never
    // reached a single row — the imported tracks arrived with no Apple Music identity and
    // no format protection at all.
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
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.wav'],
        persistentIds: { '/m/a.wav': 'A1B2C3D4E5F60718' },
        meta: {},
        missing: 0,
      }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('DC2C573644EF7017', 'Chocolate')
    })

    expect(result.current.tracks).toHaveLength(1)
    expect(result.current.tracks[0].fromAppleMusic).toBe(true)
    expect(result.current.tracks[0].musicPersistentId).toBe('A1B2C3D4E5F60718')
  })

  it('fills the editor with what Music knows and the file does not', async () => {
    // The user's WAVs carry no grouping; Music holds the one they filed the track under.
    // Reading only the file showed an empty field for something clearly filled in Music.
    const { result } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.wav'],
        persistentIds: {},
        meta: { '/m/a.wav': { grouping: 'Bases, Chocolate', year: '2020' } },
        missing: 0,
      }),
      readMeta: vi.fn().mockResolvedValue({
        tags: tags({ title: 'Tahikiry', artist: 'Elastica' }),
        duration: 376,
        cover: null,
        foreignTags: [],
      }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Chocolate')
    })

    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    expect(result.current.tracks[0].meta.grouping).toBe('Bases, Chocolate')
    expect(result.current.tracks[0].meta.year).toBe('2020')
  })

  it('lets the file win over Music, because the file is what other tools read', async () => {
    const { result } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.wav'],
        persistentIds: {},
        meta: { '/m/a.wav': { year: '2020' } },
        missing: 0,
      }),
      readMeta: vi.fn().mockResolvedValue({
        tags: tags({ title: 'Tahikiry', year: '1995' }),
        duration: 376,
        cover: null,
        foreignTags: [],
      }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Chocolate')
    })

    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    expect(result.current.tracks[0].meta.year).toBe('1995')
  })

  it('counts what Music filled in as the file’s own state, not as a pending edit', async () => {
    // The whole point of importing a collection: nothing is staged until the user changes
    // something. If the fill counted as an edit, every imported track would arrive dirty.
    const { result } = setup({
      loadAppleMusicPlaylistTracks: vi.fn().mockResolvedValue({
        paths: ['/m/a.wav'],
        persistentIds: {},
        meta: { '/m/a.wav': { grouping: 'Bases' } },
        missing: 0,
      }),
      readMeta: vi.fn().mockResolvedValue({
        tags: tags({ title: 'Tahikiry' }),
        duration: 376,
        cover: null,
        foreignTags: [],
      }),
    })

    await act(async () => {
      await result.current.importApplePlaylist('A1B2C3D4E5F60718', 'Chocolate')
    })

    await waitFor(() => expect(result.current.tracks[0].loadingMeta).toBe(false))
    const t = result.current.tracks[0]
    expect(t.diskSignature).toBe(trackSignature({ meta: t.meta }))
  })

  it('still reports when the playlist held nothing importable at all', async () => {
    // An all-streaming playlist imports zero rows. Silence here would look like the
    // click did nothing.
    const { result, onPlaylistImported } = setup({
      loadAppleMusicPlaylistTracks: vi
        .fn()
        .mockResolvedValue({ paths: [], persistentIds: {}, missing: 12 }),
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
