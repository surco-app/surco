// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Api } from '../../../preload/api'
import { emptyMetadata } from '../../../shared/metadata'
import type { Release, TrackMetadata } from '../../../shared/types'
import { coverSourceOf, keepCoverArg } from '../lib/coverSource'
import { trackSignature } from '../lib/dirty'
import { buildReleaseMeta } from '../lib/release'
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

  // A file loaded before its rekordbox playlist was opened got nothing from rekordbox, while
  // the same file opened fresh got its BPM, key and stars: the gaps are filled for it too,
  // and whatever the row already holds wins.
  it('fills the BPM, key and rating gaps of a row already loaded from its rekordbox entry', async () => {
    const readMeta = vi.fn().mockResolvedValue({
      tags: tags({ title: 'A', key: '8A' }),
      duration: null,
      cover: null,
      foreignTags: [],
    })
    const { result } = setup({ readMeta })
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    await act(async () => {
      await result.current.openSourcePlaylist(
        [
          {
            path: '/m/a.aiff',
            separator: false,
            meta: { bpm: '124', key: '5A', rating: 80, grouping: 'Peak' },
          },
        ],
        'rekordbox',
        { fillLoaded: true },
      )
    })
    const row = result.current.tracks[0]
    expect(row.meta.bpm).toBe('124')
    expect(row.meta.key).toBe('8A')
    expect(row.meta.rating).toBe('4')
    expect(row.meta.grouping).toBe('')
    // Filled the way a fresh row is: part of what was read, not an edit to convert.
    expect(row.diskSignature).toBe(trackSignature(row))
  })

  // An edit the user made stays the only change, and the filled values do not join it.
  it('keeps a filled gap out of the edits the row already had', async () => {
    const readMeta = vi.fn().mockResolvedValue({
      tags: tags({ title: 'A' }),
      duration: null,
      cover: null,
      foreignTags: [],
    })
    const { result } = setup({ readMeta })
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const id = result.current.tracks[0].id
    act(() =>
      result.current.updateTrack(id, { meta: { ...result.current.tracks[0].meta, title: 'B' } }),
    )
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: { bpm: '124' } }],
        'rekordbox',
        { fillLoaded: true },
      )
    })
    const row = result.current.tracks[0]
    expect(row.meta.bpm).toBe('124')
    expect(row.diskSignature).toBe(trackSignature({ ...row, meta: { ...row.meta, title: 'A' } }))
  })

  // Every edit re-reads the playlist; a gap the user cleared on purpose must not come back
  // on the next reorder. Only an opening fills.
  it('fills nothing on a re-read of a playlist already open', async () => {
    const readMeta = vi.fn().mockResolvedValue({
      tags: tags({ title: 'A' }),
      duration: null,
      cover: null,
      foreignTags: [],
    })
    const { result } = setup({ readMeta })
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    await act(async () => {
      await result.current.openSourcePlaylist(
        [{ path: '/m/a.aiff', separator: false, meta: { bpm: '124' } }],
        'rekordbox',
        { fillLoaded: false },
      )
    })
    expect(result.current.tracks[0].meta.bpm).toBe('')
  })

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
    let first: Promise<number> = Promise.resolve(0)
    let second: Promise<number> = Promise.resolve(0)
    act(() => {
      first = result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
      second = result.current.openSourcePlaylist(entries(['/m/a.aiff', '/m/b.aiff']), 'rekordbox')
    })
    await act(async () => {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
      for (const resolve of pending) resolve()
      await Promise.all([first, second])
    })
    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff', '/m/b.aiff'])
  })

  // The NAS stores names decomposed while a drop hands Surco the composed spelling: the
  // same file under both must stay one row, or the user's edits sit on the row the
  // playlist no longer shows and the crate converts the file twice.
  it('treats a decomposed playlist path as the composed track already loaded', async () => {
    const composed = '/m/Canci\u00f3n.wav'
    const decomposed = '/m/Cancio\u0301n.wav'
    const { result, expandPaths } = setup()
    await act(async () => {
      await result.current.addPaths([composed])
    })
    expandPaths.mockClear()
    await act(async () => {
      await result.current.openSourcePlaylist(entries([decomposed]), 'rekordbox')
    })
    expect(expandPaths).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual([composed])
  })

  // After a conversion that is not in place, rekordbox's row names the output; the next
  // refocus must not load that output as a new, unconverted copy of the same track.
  it('treats the output of a converted track as loaded', async () => {
    const { result, expandPaths } = setup()
    await act(async () => {
      await result.current.addPaths(['/m/a.wav'])
    })
    act(() =>
      result.current.updateTrack(result.current.tracks[0].id, { outputPath: '/out/a.aiff' }),
    )
    expandPaths.mockClear()
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/out/a.aiff']), 'rekordbox')
    })
    expect(expandPaths).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.wav'])
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
        [
          {
            path: '/m/a.wav',
            separator: false,
            meta: { grouping: 'Bases, Chocolate', year: '2020' },
          },
        ],
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

describe('opening a rekordbox playlist with previews', () => {
  const preview = (title: string) => ({
    title,
    artist: 'Rebel Vision',
    durationSec: 256,
    cues: [{ ms: 1000, kind: 1, color: null }],
  })
  const entry = (path: string, title: string) => ({
    path,
    separator: false,
    meta: {},
    contentId: path,
    preview: preview(title),
  })

  it('adds the rows before the disk check answers, each with its preview', async () => {
    let answer: (paths: string[]) => void = () => {}
    const expandPaths = vi.fn<Api['expandPaths']>(() => new Promise<string[]>((r) => (answer = r)))
    const read = vi.fn<Api['readMetaLight']>(() => new Promise(() => {}))
    const { result } = setup({ expandPaths, readMeta: read, readMetaLight: read })
    let opened: Promise<number> = Promise.resolve(0)
    act(() => {
      opened = result.current.openSourcePlaylist(
        [entry('/m/a.aiff', 'A'), entry('/m/b.aiff', 'B')],
        'rekordbox',
      )
    })
    await waitFor(() => expect(result.current.tracks).toHaveLength(2))
    expect(result.current.tracks.map((t) => t.sourcePreview?.title)).toEqual(['A', 'B'])
    answer(['/m/a.aiff', '/m/b.aiff'])
    await act(async () => {
      await opened
    })
  })

  it('drops the row of a file the disk lacks and counts it once, as missing and not as unreadable', async () => {
    const read = vi.fn<Api['readMetaLight']>((path: string) =>
      path === '/m/gone.aiff'
        ? new Promise((_, reject) => setTimeout(() => reject(new Error('ENOENT')), 20))
        : Promise.resolve({
            tags: tags({ title: 'A' }),
            duration: 1,
            cover: null,
            foreignTags: [],
            partial: true,
          }),
    )
    const expandPaths = vi.fn<Api['expandPaths']>(async () => ['/m/a.aiff'])
    const onMetaReadFailed = vi.fn()
    const { result } = setup(
      { expandPaths, readMeta: read, readMetaLight: read },
      { onMetaReadFailed },
    )
    let missing = -1
    await act(async () => {
      missing = await result.current.openSourcePlaylist(
        [entry('/m/a.aiff', 'A'), entry('/m/gone.aiff', 'Gone')],
        'rekordbox',
      )
    })
    expect(missing).toBe(1)
    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/m/a.aiff'])
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40))
    })
    expect(onMetaReadFailed).not.toHaveBeenCalled()
  })

  it('leaves the first track that exists selected when the first one listed is missing', async () => {
    let selection: { ids: string[]; anchor: string | null } = { ids: [], anchor: null }
    const setSelection = vi.fn((next: unknown) => {
      selection =
        typeof next === 'function'
          ? (next as (s: typeof selection) => typeof selection)(selection)
          : (next as typeof selection)
    })
    const expandPaths = vi.fn<Api['expandPaths']>(async () => ['/m/a.aiff'])
    const { result } = setup({ expandPaths }, { setSelection })
    await act(async () => {
      await result.current.openSourcePlaylist(
        [entry('/m/gone.aiff', 'Gone'), entry('/m/a.aiff', 'A')],
        'rekordbox',
      )
    })
    const first = result.current.tracks[0]
    expect(first.inputPath).toBe('/m/a.aiff')
    expect(selection).toEqual({ ids: [first.id], anchor: first.id })
  })

  it('refreshes the preview of a converted row that rekordbox now lists by its output', async () => {
    const read = vi.fn<Api['readMetaLight']>().mockResolvedValue({
      tags: tags({ title: 'A' }),
      duration: 255,
      cover: null,
      foreignTags: [],
      partial: true,
    })
    const { result } = setup({ readMeta: read, readMetaLight: read })
    await act(async () => {
      await result.current.openSourcePlaylist([entry('/m/a.wav', 'A')], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    act(() =>
      result.current.updateTrack(result.current.tracks[0].id, { outputPath: '/out/a.aiff' }),
    )
    const before = result.current.tracks[0]
    const atOutput = {
      ...entry('/out/a.aiff', 'A'),
      preview: {
        ...preview('A'),
        cues: [
          { ms: 1000, kind: 1, color: null },
          { ms: 64000, kind: 2, color: null },
        ],
      },
    }
    await act(async () => {
      await result.current.openSourcePlaylist([atOutput], 'rekordbox')
    })
    const after = result.current.tracks[0]
    expect(after.sourcePreview?.cues).toHaveLength(2)
    expect(after.diskSignature).toBe(before.diskSignature)
    expect(after.diskSignature).toBe(trackSignature(after))
  })

  it('never counts the preview as an edit once the file is read', async () => {
    const read = vi.fn<Api['readMetaLight']>().mockResolvedValue({
      tags: tags({ title: 'A from file', artist: 'File Artist' }),
      duration: 255,
      cover: null,
      foreignTags: [],
      partial: true,
    })
    const { result } = setup({ readMeta: read, readMetaLight: read })
    await act(async () => {
      await result.current.openSourcePlaylist([entry('/m/a.aiff', 'A')], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const row = result.current.tracks[0]
    expect(row.meta.title).toBe('A from file')
    expect(row.diskSignature).toBe(trackSignature(row))
  })

  it('refreshes the preview of a row already loaded when the playlist is read again', async () => {
    const read = vi.fn<Api['readMetaLight']>().mockResolvedValue({
      tags: tags({ title: 'A' }),
      duration: 255,
      cover: null,
      foreignTags: [],
      partial: true,
    })
    const { result } = setup({ readMeta: read, readMetaLight: read })
    await act(async () => {
      await result.current.openSourcePlaylist([entry('/m/a.aiff', 'A')], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const before = result.current.tracks[0]
    const withNewCue = {
      ...entry('/m/a.aiff', 'A'),
      preview: {
        ...preview('A'),
        cues: [
          { ms: 1000, kind: 1, color: null },
          { ms: 64000, kind: 2, color: null },
        ],
      },
    }
    await act(async () => {
      await result.current.openSourcePlaylist([withNewCue], 'rekordbox')
    })
    const after = result.current.tracks[0]
    expect(after.sourcePreview?.cues).toHaveLength(2)
    expect(after.diskSignature).toBe(before.diskSignature)
    expect(after.diskSignature).toBe(trackSignature(after))
  })
})

describe('the light read of a rekordbox row', () => {
  const entry = {
    path: '/m/a.aiff',
    separator: false,
    meta: {},
    contentId: 'c1',
    preview: { title: 'A', artist: 'R', durationSec: 256, cues: [] },
  }
  const light = {
    tags: tags({ title: 'A' }),
    duration: 255,
    cover: null,
    foreignTags: [],
    partial: true,
  }
  const full = {
    tags: tags({ title: 'A' }),
    duration: 255,
    cover: { thumbUrl: 'surco://cover/a.jpg', width: 600, height: 600 },
    foreignTags: [{ name: 'ENERGY', value: '7' }],
  }

  it('lists the row from the light read and leaves it marked as partial', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    expect(readMeta).not.toHaveBeenCalled()
    expect(result.current.tracks[0].metaPartial).toBe(true)
  })

  it('completes the cover and foreign tags without the row reading as edited', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    await act(async () => {
      await result.current.completeTrackMeta(result.current.tracks[0].id)
    })
    const row = result.current.tracks[0]
    expect(row.metaPartial).toBe(false)
    expect(row.embeddedCover).toBe('surco://cover/a.jpg')
    expect(row.coverUrl).toBe('surco://cover/a.jpg')
    expect(row.foreignTags).toEqual([{ name: 'ENERGY', value: '7' }])
    expect(row.diskSignature).toBe(trackSignature(row))
  })

  it('adopts the file art for a row edited before its full read, so a later match keeps it and only the edit reads as modified', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const id = result.current.tracks[0].id
    const readMetaValue = result.current.tracks[0].meta
    act(() =>
      result.current.updateTrack(id, { meta: { ...readMetaValue, comment: 'typed early' } }),
    )
    await act(async () => {
      await result.current.completeTrackMeta(id)
    })
    const row = result.current.tracks[0]
    expect(row.metaPartial).toBe(false)
    expect(row.diskSignature).not.toBe(trackSignature(row))
    expect(row.diskSignature).toBe(trackSignature({ ...row, meta: readMetaValue }))
    const withArt: Release = {
      provider: 'discogs',
      id: 1,
      title: 'Album',
      artists: [{ name: 'R' }],
      tracklist: [{ position: '1', title: 'A' }],
      images: [{ uri: 'https://discogs/cover.jpg', type: 'primary', resource_url: '' }],
    }
    const pick = buildReleaseMeta(row.meta, withArt, withArt.tracklist[0], keepCoverArg(row))
    const matched = { ...row, meta: pick.meta, coverUrl: pick.coverUrl, coverPath: pick.coverPath }
    expect(coverSourceOf(matched)).toEqual({ coverFromFile: '/m/a.aiff' })
  })

  it('lets a conversion wait for the completion the selection already started, instead of refusing the row', async () => {
    let answer: (read: typeof full) => void = () => {}
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>(() => new Promise<typeof full>((r) => (answer = r)))
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const id = result.current.tracks[0].id
    let partialWhenSecondSettled: boolean | undefined
    await act(async () => {
      void result.current.completeTrackMeta(id)
      const second = result.current.completeTrackMeta(id).then(() => {
        partialWhenSecondSettled = result.current.tracksRef.current[0].metaPartial
      })
      answer(full)
      await second
    })
    expect(readMeta).toHaveBeenCalledTimes(1)
    expect(partialWhenSecondSettled).toBe(false)
  })

  it('leaves the row partial when the full read throws, so the conversion refuses it instead of crashing', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockRejectedValue(new Error('gone'))
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    await act(async () => {
      await expect(result.current.completeTrackMeta(result.current.tracks[0].id)).resolves.toBe(
        undefined,
      )
    })
    expect(result.current.tracks[0].metaPartial).toBe(true)
  })

  it('removes the foreign tags the full read finds when the row was cleared before it landed', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist([entry], 'rekordbox')
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    const id = result.current.tracks[0].id
    act(() => result.current.clearExtrasTracks([id]))
    const cleared = result.current.tracks[0]
    expect(cleared.foreignRemoved).toEqual([])
    expect(cleared.metaCleared).toBe(true)
    await act(async () => {
      await result.current.completeTrackMeta(id)
    })
    const row = result.current.tracks[0]
    expect(row.foreignRemoved).toEqual(['ENERGY'])
    expect(row.metaCleared).toBe(true)
    expect(row.coverUrl).toBeUndefined()
    expect(row.diskSignature).toBe(cleared.diskSignature)
    expect(trackSignature(row)).not.toBe(row.diskSignature)
  })

  it('completes a large selection through the shared read cap, never more than six reads at once', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      ...entry,
      path: `/m/${i}.aiff`,
      contentId: `c${i}`,
    }))
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const pending: Array<() => void> = []
    let inFlight = 0
    let peak = 0
    const readMeta = vi.fn<Api['readMeta']>(
      () =>
        new Promise<typeof full>((resolve) => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          pending.push(() => {
            inFlight -= 1
            resolve(full)
          })
        }),
    )
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.openSourcePlaylist(entries, 'rekordbox')
    })
    await waitFor(() =>
      expect(result.current.tracks.every((t) => t.metaPartial === true)).toBe(true),
    )
    let all: Promise<unknown> = Promise.resolve()
    await act(async () => {
      all = Promise.all(result.current.tracks.map((t) => result.current.completeTrackMeta(t.id)))
    })
    expect(readMeta).toHaveBeenCalledTimes(6)
    await act(async () => {
      while (pending.length) {
        pending.shift()?.()
        await Promise.resolve()
        await Promise.resolve()
      }
      await all
    })
    expect(peak).toBe(6)
    expect(readMeta).toHaveBeenCalledTimes(10)
    expect(result.current.tracks.every((t) => t.metaPartial === false)).toBe(true)
  })

  it('reads a dropped file fully, as before', async () => {
    const readMetaLight = vi.fn<Api['readMetaLight']>().mockResolvedValue(light)
    const readMeta = vi.fn<Api['readMeta']>().mockResolvedValue(full)
    const { result } = setup({ readMetaLight, readMeta })
    await act(async () => {
      await result.current.addPaths(['/m/b.aiff'])
    })
    await waitFor(() => expect(result.current.tracks[0]?.loadingMeta).toBeFalsy())
    expect(readMetaLight).not.toHaveBeenCalled()
    expect(result.current.tracks[0].metaPartial).toBeFalsy()
  })
})

describe('Files and the source playlists keep their own tracks', () => {
  const entries = (paths: string[]) => paths.map((path) => ({ path, separator: false, meta: {} }))

  it('keeps a playlist row out of Files and puts a dropped one in it', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
      await result.current.addPaths(['/m/b.aiff'])
    })
    const byPath = (p: string) => result.current.tracks.find((t) => t.inputPath === p)
    expect(byPath('/m/a.aiff')?.inFiles).toBeFalsy()
    expect(byPath('/m/b.aiff')?.inFiles).toBe(true)
  })

  it('brings a restored session back into Files', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'], {})
    })
    expect(result.current.tracks[0].inFiles).toBe(true)
  })

  it('puts a dropped file that is already in an open playlist in Files as the same row, without a duplicate notice', async () => {
    const onDuplicatesSkipped = vi.fn()
    const { result } = setup({}, { onDuplicatesSkipped })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'appleMusic')
    })
    const id = result.current.tracks[0].id
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    expect(result.current.tracks).toHaveLength(1)
    expect(result.current.tracks[0]).toMatchObject({ id, inFiles: true })
    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
  })

  it('still reports a file dropped twice into Files as a skipped duplicate', async () => {
    const onDuplicatesSkipped = vi.fn()
    const { result } = setup({}, { onDuplicatesSkipped })
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
      await result.current.addPaths(['/m/a.aiff'])
    })
    expect(onDuplicatesSkipped).toHaveBeenCalledWith(1)
  })

  it('does not put a playlist row in Files when its own disk check streams it back', async () => {
    let stream: (paths: string[]) => void = () => {}
    const { result } = setup({
      onExpandedBatch: vi.fn<Api['onExpandedBatch']>((cb) => {
        stream = cb
        return () => {}
      }),
      expandPaths: vi.fn<Api['expandPaths']>(async (paths) => {
        stream(paths)
        return paths
      }),
    })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
    })
    expect(result.current.tracks[0].inFiles).toBeFalsy()
  })

  it('takes rows removed in Files out of Files only while a playlist lists them', async () => {
    const onRemove = vi.fn()
    const { result } = setup({}, { onRemove, filesOpen: true })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
      await result.current.addPaths(['/m/a.aiff', '/m/b.aiff'])
    })
    const [a, b] = result.current.tracks
    act(() => result.current.removeTracks([a.id, b.id]))
    expect(result.current.tracks).toEqual([expect.objectContaining({ id: a.id, inFiles: false })])
    expect(onRemove).toHaveBeenCalledWith([expect.objectContaining({ id: b.id })])
  })

  it('keeps a row removed from Files by its ✕ for the playlist that lists it', async () => {
    const { result } = setup({}, { filesOpen: true })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'appleMusic')
      await result.current.addPaths(['/m/a.aiff'])
    })
    act(() => result.current.removeTrack(result.current.tracks[0].id))
    expect(result.current.tracks).toEqual([expect.objectContaining({ inFiles: false })])
  })

  it('removes a row from a source view as before, Files included', async () => {
    const { result } = setup({}, { filesOpen: false })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
      await result.current.addPaths(['/m/a.aiff'])
    })
    act(() => result.current.removeTrack(result.current.tracks[0].id))
    expect(result.current.tracks).toHaveLength(0)
  })

  it('keeps a row started over in Files', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.addPaths(['/m/a.aiff'])
    })
    act(() => result.current.startOverTrack(result.current.tracks[0]))
    expect(result.current.tracks[0].inFiles).toBe(true)
  })

  it('empties Files without dropping the rows a playlist lists', async () => {
    const { result } = setup({}, { filesOpen: true })
    await act(async () => {
      await result.current.openSourcePlaylist(entries(['/m/a.aiff']), 'rekordbox')
      await result.current.addPaths(['/m/a.aiff', '/m/b.aiff'])
    })
    act(() => result.current.clearTracks())
    expect(result.current.tracks).toEqual([
      expect.objectContaining({ inputPath: '/m/a.aiff', inFiles: false }),
    ])
  })
})
