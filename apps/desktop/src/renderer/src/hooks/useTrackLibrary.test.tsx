// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NEW_TRACKS_PROMPT_TIMEOUT_MS, useTrackLibrary } from './useTrackLibrary'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

type FoldersChangedCb = (root: string, files: string[]) => void
type ExpandedBatchCb = (paths: string[]) => void

function setApi(over: Record<string, unknown> = {}): {
  fire: FoldersChangedCb
  fireBatch: ExpandedBatchCb
} {
  let cb: FoldersChangedCb = () => {}
  let batchCb: ExpandedBatchCb = () => {}
  ;(window as unknown as { api: unknown }).api = {
    takePendingFiles: vi.fn().mockResolvedValue([]),
    onOpenFiles: vi.fn(() => () => {}),
    onExpandedBatch: vi.fn((fn: ExpandedBatchCb) => {
      batchCb = fn
      return () => {}
    }),
    onFoldersChanged: vi.fn((fn: FoldersChangedCb) => {
      cb = fn
      return () => {}
    }),
    unwatchFolders: vi.fn().mockResolvedValue(undefined),
    expandPaths: vi.fn().mockResolvedValue([]),
    readMeta: vi.fn().mockResolvedValue({
      tags: {},
      duration: null,
      cover: null,
      foreignTags: [],
    }),
    recordStat: vi.fn(),
    ...over,
  }
  return { fire: (root, files) => cb(root, files), fireBatch: (paths) => batchCb(paths) }
}

function setup(): {
  result: { current: ReturnType<typeof useTrackLibrary> }
  fire: FoldersChangedCb
  fireBatch: ExpandedBatchCb
  onDuplicatesSkipped: ReturnType<typeof vi.fn>
  onNoAudioFound: ReturnType<typeof vi.fn>
} {
  const { fire, fireBatch } = setApi()
  const onDuplicatesSkipped = vi.fn()
  const onNoAudioFound = vi.fn()
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped,
      onNoAudioFound,
      onMetaReadFailed: vi.fn(),
    }),
  )
  return { result, fire, fireBatch, onDuplicatesSkipped, onNoAudioFound }
}

describe('useTrackLibrary drops with nothing to add', () => {
  // Dropping a folder with no audio did nothing at all: no row, no toast, no change. The
  // same silence covered a failed stat() - a denied permission, a dropped SMB mount, a
  // broken alias all collapse to "zero paths" in expand.ts - so the user cannot tell
  // "there is nothing here" from "I could not read it". Duplicates already report; this
  // was the remaining silent no-op, and the more confusing of the two (with duplicates
  // there are at least rows on screen).
  it('reports a drop that carried no audio at all', async () => {
    const { result, onNoAudioFound } = setup()

    await act(async () => {
      await result.current.addPaths(['/music/artwork.jpg', '/music/notes.txt'])
    })

    expect(onNoAudioFound).toHaveBeenCalledTimes(1)
  })

  // A drop whose files are all already loaded is NOT this case: those paths ARE audio, the
  // duplicate notice already explains them, and firing both would double-report one drop.
  it('stays quiet when the audio was there but already loaded', async () => {
    const { result, onNoAudioFound, onDuplicatesSkipped } = setup()

    await act(async () => {
      await result.current.addPaths(['/music/a.wav'])
    })
    await act(async () => {
      await result.current.addPaths(['/music/a.wav'])
    })

    expect(onDuplicatesSkipped).toHaveBeenCalledWith(1)
    expect(onNoAudioFound).not.toHaveBeenCalled()
  })
})

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
        onNoAudioFound: vi.fn(),
        onMetaReadFailed: vi.fn(),
      }),
    )

    act(() => fire('/music/oldcrate', ['/music/oldcrate/a.flac']))

    expect(unwatchFolders).toHaveBeenCalledTimes(1)
  })
})

function setupWithTracks(): ReturnType<typeof setup> {
  const { fire, fireBatch } = setApi({
    readMeta: vi
      .fn()
      .mockResolvedValue({ tags: { title: '', artist: '' }, duration: 180, cover: null }),
  })
  const onDuplicatesSkipped = vi.fn()
  const onNoAudioFound = vi.fn()
  const { result } = renderHook(() =>
    useTrackLibrary({
      setSelection: vi.fn(),
      onForget: vi.fn(),
      onRemove: vi.fn(),
      onClear: vi.fn(),
      onMetaLoaded: vi.fn(),
      onDuplicatesSkipped,
      onNoAudioFound: vi.fn(),
      onMetaReadFailed: vi.fn(),
    }),
  )
  return { result, fire, fireBatch, onDuplicatesSkipped, onNoAudioFound }
}

describe('useTrackLibrary removed tracks vs watcher', () => {
  // Removing a track with the X takes it out of the crate but not off the disk, so the
  // watcher's next report (a folder change, or the 60s safety poll) still lists its file.
  // Diffing that against the crate alone would flag the just-removed file as "new" and pop
  // the load prompt for tracks the user deliberately took out.
  it('does not offer tracks the user removed as new when the watcher fires', async () => {
    const { result, fire } = setupWithTracks()
    await act(() => result.current.addPaths(['/m/a.wav', '/m/b.wav']))
    const a = result.current.tracks.find((t) => t.inputPath === '/m/a.wav')
    if (!a) throw new Error('track not loaded')

    act(() => result.current.removeTrack(a.id))
    act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))

    expect(result.current.pendingNew).toBeNull()
  })

  it('still offers genuinely new files after a removal', async () => {
    const { result, fire } = setupWithTracks()
    await act(() => result.current.addPaths(['/m/a.wav', '/m/b.wav']))
    const a = result.current.tracks.find((t) => t.inputPath === '/m/a.wav')
    if (!a) throw new Error('track not loaded')

    act(() => result.current.removeTracks([a.id]))
    act(() => fire('/m', ['/m/a.wav', '/m/b.wav', '/m/c.wav']))

    expect(result.current.pendingNew).toEqual({ root: '/m', paths: ['/m/c.wav'] })
  })
})

describe('useTrackLibrary own outputs vs watcher', () => {
  // Converting into (or inside) the watched folder makes the app's own output appear in
  // the watcher's next report. Diffing against inputPath alone offered Surco's own
  // conversions back as "new tracks" — accepting imported duplicate rows, and a later
  // Convert all re-converted already-converted files.
  it('does not offer the app’s own conversion outputs as new tracks', async () => {
    const { result, fire } = setupWithTracks()
    await act(() => result.current.addPaths(['/m/a.wav', '/m/b.wav']))
    const a = result.current.tracks.find((t) => t.inputPath === '/m/a.wav')
    if (!a) throw new Error('track not loaded')

    act(() => result.current.updateTrack(a.id, { outputPath: '/m/a.aiff', status: 'done' }))
    act(() => fire('/m', ['/m/a.wav', '/m/b.wav', '/m/a.aiff']))

    expect(result.current.pendingNew).toBeNull()
  })
})

describe('useTrackLibrary new-tracks prompt lifetime', () => {
  // The watcher's safety poll re-reports the folder every minute whether or not anything
  // changed. Without remembering the declined offer, a dismissed prompt would resurrect on
  // the next poll (same unloaded files, still "new") — an endless popup for files the user
  // already said no to. A genuinely new file must still prompt, counting only itself.
  it('does not re-offer files the user dismissed', async () => {
    const { result, fire } = setupWithTracks()
    await act(() => result.current.addPaths(['/m/a.wav']))

    act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))
    expect(result.current.pendingNew).toEqual({ root: '/m', paths: ['/m/b.wav'] })
    act(() => result.current.dismissPending())
    act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))
    expect(result.current.pendingNew).toBeNull()

    act(() => fire('/m', ['/m/a.wav', '/m/b.wav', '/m/c.wav']))
    expect(result.current.pendingNew).toEqual({ root: '/m', paths: ['/m/c.wav'] })
  })

  // A poll that reports the same still-unloaded files must not rebuild the pending object:
  // its identity drives the toast effect (and the auto-dismiss timer), so churn would
  // restart the prompt's countdown every minute and it would never expire.
  it('keeps the pending object identical when a poll reports nothing new', async () => {
    const { result, fire } = setupWithTracks()
    await act(() => result.current.addPaths(['/m/a.wav']))

    act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))
    const first = result.current.pendingNew
    act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))

    expect(result.current.pendingNew).toBe(first)
  })

  // The prompt must not demand an answer: left alone it times out, and timing out counts
  // as declining — otherwise the next poll would raise it again a minute later.
  it('expires the prompt on its own and does not re-offer the files', async () => {
    vi.useFakeTimers()
    try {
      const { result, fire } = setupWithTracks()
      await act(() => result.current.addPaths(['/m/a.wav']))

      act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))
      expect(result.current.pendingNew).not.toBeNull()
      act(() => vi.advanceTimersByTime(NEW_TRACKS_PROMPT_TIMEOUT_MS))
      expect(result.current.pendingNew).toBeNull()

      act(() => fire('/m', ['/m/a.wav', '/m/b.wav']))
      expect(result.current.pendingNew).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useTrackLibrary import batching', () => {
  // Every file that lands its metadata read used to fire its own setTracks(prev.map(...)).
  // React coalesces the resulting renders into one, but it still RUNS each updater to fold
  // the state: N reads each mapping the N-row array is N² element visits (plus N discarded
  // intermediate arrays) of pure JS — the copy churn that froze a big drop while it loaded.
  // Coalescing the read patches into a single map keeps that work linear in the file count.
  // The final rows must match the per-file path exactly: same metadata, duration, and
  // cleared loading flag.
  it('applies simultaneous metadata reads with linear, not quadratic, array work', async () => {
    const N = 40
    const paths = Array.from({ length: N }, (_, i) => `/m/track-${i}.wav`)
    let resolveAll: (() => void) | null = null
    const gate = new Promise<void>((r) => {
      resolveAll = r
    })
    setApi({
      readMeta: vi.fn(async (path: string) => {
        await gate
        const n = path.match(/track-(\d+)/)?.[1] ?? ''
        return { tags: { title: `Title ${n}`, artist: `Artist ${n}` }, duration: 200, cover: null }
      }),
    })
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
      }),
    )

    // The synchronous part of addPaths (placeholder rows, progress start) settles first.
    await act(async () => {
      void result.current.addPaths(paths)
      await Promise.resolve()
    })

    // Count element visits over arrays of the crate's size while the reads flush. Per-file
    // setTracks(prev.map) over the N-row array visits ~N² elements; a batched flush visits ~N.
    const realMap = Array.prototype.map
    let bigMapVisits = 0
    // eslint-disable-next-line no-extend-native
    Array.prototype.map = function mapSpy<T, U>(
      this: T[],
      callback: (value: T, index: number, array: T[]) => U,
      thisArg?: unknown,
    ): U[] {
      if (this.length >= N) bigMapVisits += this.length
      return realMap.call(this, callback, thisArg) as U[]
    }
    try {
      await act(async () => {
        resolveAll?.()
        await new Promise((r) => setTimeout(r, 50))
      })
    } finally {
      Array.prototype.map = realMap
    }

    // All rows carry their read metadata and are no longer loading.
    expect(result.current.tracks).toHaveLength(N)
    for (const t of result.current.tracks) {
      const n = t.inputPath.match(/track-(\d+)/)?.[1] ?? ''
      expect(t.meta.title).toBe(`Title ${n}`)
      expect(t.meta.artist).toBe(`Artist ${n}`)
      expect(t.duration).toBe(200)
      expect(t.loadingMeta).toBe(false)
    }
    // Sub-quadratic: the reads that resolve in the same microtask checkpoint coalesce, so a
    // batch rewrites the array a handful of times (~N each), never the full N² (=1600) the
    // per-file path cost. A generous ceiling still fails hard on the O(n²) regression while
    // leaving headroom for however the concurrency workers interleave their resolutions.
    expect(bigMapVisits).toBeLessThan(N * 10)
  })
})

describe('useTrackLibrary cache hydration', () => {
  // The batch hydration's whole point: addPaths must hand the freshly added paths to
  // onPathsAdded once the drop is deduped, so the caller can seed the disk-cached
  // verdicts in one round trip instead of waiting for each track's own lazy probe.
  it('reports the freshly added paths once, excluding duplicates already in the crate', async () => {
    const onPathsAdded = vi.fn()
    setApi({
      readMeta: vi
        .fn()
        .mockResolvedValue({ tags: { title: '', artist: '' }, duration: 180, cover: null }),
    })
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
        onPathsAdded,
      }),
    )

    await act(() => result.current.addPaths(['/m/a.wav', '/m/b.wav']))
    expect(onPathsAdded).toHaveBeenCalledExactlyOnceWith(['/m/a.wav', '/m/b.wav'])

    onPathsAdded.mockClear()
    await act(() => result.current.addPaths(['/m/a.wav', '/m/c.wav']))
    expect(onPathsAdded).toHaveBeenCalledExactlyOnceWith(['/m/c.wav'])
  })
})

describe('useTrackLibrary foreign tags', () => {
  // The inspector shows the third-party tags a file carries (SERATO_MARKERS_V2,
  // MUSICBRAINZ_*…) so the user can review and delete them. The read already returns
  // them (Task 2); this asserts they land on the track row instead of being dropped.
  it('keeps the foreign tags the read returns on the track', async () => {
    const foreign = [{ name: 'SERATO_MARKERS_V2', value: 'x' }]
    setApi({
      readMeta: vi.fn().mockResolvedValue({
        tags: { title: '', artist: '' },
        duration: 180,
        cover: null,
        foreignTags: foreign,
      }),
    })
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
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))

    expect(result.current.tracks[0]?.foreignTags).toEqual(foreign)
  })

  // Bulk "clear everything" flags every selected track's own foreign tags as removed,
  // not a shared list: patchTracks applies one flat patch to every id, which would
  // either drop one track's foreign tags or wrongly stamp another's onto it.
  it('clearExtrasTracks marks each track with its own foreignRemoved', async () => {
    setApi({
      readMeta: vi
        .fn()
        .mockResolvedValueOnce({
          tags: { title: '', artist: '' },
          duration: 180,
          cover: null,
          foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }],
        })
        .mockResolvedValueOnce({
          tags: { title: '', artist: '' },
          duration: 180,
          cover: null,
          foreignTags: [{ name: 'TRAKTOR4', value: 'y' }],
        }),
    })
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
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav', '/m/b.wav']))
    const [a, b] = result.current.tracks
    act(() => result.current.clearExtrasTracks([a.id, b.id]))

    const [ra, rb] = result.current.tracks
    expect(ra.foreignRemoved).toEqual(['SERATO_MARKERS_V2'])
    expect(ra.coverRemoved).toBe(true)
    expect(ra.metaCleared).toBe(true)
    expect(rb.foreignRemoved).toEqual(['TRAKTOR4'])
  })

  // A per-tag delete staged before a crash/reopen must come back on the restored row,
  // exactly like metaCleared — otherwise the reopened session silently forgets which
  // foreign tags the user had already marked for removal.
  it('restores foreignRemoved from a saved session edit', async () => {
    setApi({
      readMeta: vi.fn().mockResolvedValue({
        tags: { title: '', artist: '' },
        duration: 180,
        cover: null,
        foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }],
      }),
    })
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
      }),
    )
    await act(() =>
      result.current.addPaths(['/m/a.wav'], {
        '/m/a.wav': { meta: { title: 'Restored' } as never, foreignRemoved: ['SERATO_MARKERS_V2'] },
      }),
    )

    expect(result.current.tracks[0]?.foreignRemoved).toEqual(['SERATO_MARKERS_V2'])
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
        onNoAudioFound: vi.fn(),
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
        onNoAudioFound: vi.fn(),
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

describe('useTrackLibrary streamed import batches', () => {
  // The whole point of streaming the walk: on an SMB crate (560 folders, ~20s to walk)
  // the first files are known after ~1s, and the list must fill from them instead of
  // staying empty — the "nothing happened" gap the user reported after dropping a folder.
  it('adds rows from a batch that arrives while the walk is still running', async () => {
    const { result, fireBatch } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav', '/music/b.flac'])
    })

    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/music/a.wav', '/music/b.flac'])
  })

  // Batches are an early view of what expandPaths finally resolves with, so the same
  // paths arrive twice by design. Without dedupe every streamed track would double when
  // the walk finished — the import must be idempotent, not merely fast.
  it('does not duplicate rows when the final result repeats the streamed paths', async () => {
    const { result, fireBatch } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav'])
    })
    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))

    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/music/a.wav', '/music/b.flac'])
  })

  // "Already in the list, skipped" means the USER re-dropped something they already had.
  // A path Surco itself streamed moments earlier is not that: the final result repeating
  // the batches is our own plumbing, and warning about it accuses the user of a duplicate
  // they never made. One dropped folder must produce no skip notice at all.
  it('does not report the paths it streamed itself as skipped duplicates', async () => {
    const { result, fireBatch, onDuplicatesSkipped } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav'])
    })
    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))

    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
  })

  // A real walk pays out many batches, and the reported bug was a *stack* of toasts — one
  // per batch — burying the UI on a large crate. Every batch is self-inflicted, so no
  // count of them may reach the user.
  it('stays silent across many streamed batches from one walk', async () => {
    const { result, fireBatch, onDuplicatesSkipped } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav', '/music/b.flac'])
      fireBatch(['/music/c.aiff'])
      fireBatch(['/music/a.wav', '/music/d.mp3'])
    })
    await act(() =>
      result.current.addPaths(['/music/a.wav', '/music/b.flac', '/music/c.aiff', '/music/d.mp3']),
    )

    expect(onDuplicatesSkipped).not.toHaveBeenCalled()
  })

  // The notice still has a job: dropping a folder the user already imported is a genuine
  // no-op worth explaining. Killing the false positives must not kill the true one.
  it('still reports duplicates when the user re-drops paths already in the crate', async () => {
    const { result, onDuplicatesSkipped } = setup()

    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))
    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))

    expect(onDuplicatesSkipped).toHaveBeenCalledWith(2)
  })

  // A local folder pays out its batches back-to-back, so two land in the same tick with no
  // render in between. tracksRef only catches up when React repaints, so both batches read
  // the same stale crate, neither sees the other's rows, and a path in both is added twice —
  // the duplicated tracks users hit on 0.75.0/0.75.1. Dedupe must therefore happen against
  // the queued state inside setTracks, not against a render-time snapshot.
  it('does not duplicate a path shared by two batches in the same tick', async () => {
    const { result, fireBatch } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav'])
      fireBatch(['/music/a.wav', '/music/b.flac'])
    })

    expect(result.current.tracks.map((t) => t.inputPath)).toEqual(['/music/a.wav', '/music/b.flac'])
  })

  // Only the paths two same-tick batches shared ever doubled, which is why the crate came
  // back with some tracks twice and most exactly once — the "hay algunas q solo mete una"
  // the user reported. Each path must land once regardless of how many batches carried it.
  it('adds each path once when overlapping batches carry different subsets', async () => {
    const { result, fireBatch } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav', '/music/b.flac'])
      fireBatch(['/music/b.flac', '/music/c.aiff'])
      fireBatch(['/music/d.mp3'])
    })

    expect(result.current.tracks.map((t) => t.inputPath)).toEqual([
      '/music/a.wav',
      '/music/b.flac',
      '/music/c.aiff',
      '/music/d.mp3',
    ])
  })

  // Re-dropping a folder replays the whole import, streamed batches included, so the
  // second walk re-marks the very paths it is about to report. Unless each import's marks
  // are consumed by its own final pass, that second drop goes silent — which is how the
  // first cut of this fix broke the notice outright while the unit tests stayed green.
  it('reports the re-drop of a folder that was originally streamed in', async () => {
    const { result, fireBatch, onDuplicatesSkipped } = setup()

    await act(async () => {
      fireBatch(['/music/a.wav'])
    })
    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))
    await act(async () => {
      fireBatch(['/music/a.wav'])
    })
    await act(() => result.current.addPaths(['/music/a.wav', '/music/b.flac']))

    expect(onDuplicatesSkipped).toHaveBeenCalledTimes(1)
    expect(onDuplicatesSkipped).toHaveBeenCalledWith(2)
  })
})

function setupWith(readMeta: ReturnType<typeof vi.fn>): {
  result: { current: ReturnType<typeof useTrackLibrary> }
} {
  setApi({ readMeta })
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
    }),
  )
  return { result }
}

describe('useTrackLibrary refresh after an in-place export', () => {
  // An in-place export rewrote the very file the row describes, so the row must be
  // re-read: otherwise it keeps the title and the artwork the file had before the
  // conversion, describing bytes that no longer exist.
  it('relabels the row and takes the new cover from the file', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'From Absolom To Heaven', artist: 'Mike Absolom' },
        duration: 345,
        cover: { thumbUrl: 'data:image/jpeg;base64,NEW', width: 600, height: 600 },
        foreignTags: [],
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))
    const id = result.current.tracks[0].id

    await act(() => result.current.refreshTrackFromDisk(id, '/m/a.wav'))

    expect(result.current.tracks[0].listLabel).toBe('From Absolom To Heaven')
    expect(result.current.tracks[0].embeddedCover).toBe('data:image/jpeg;base64,NEW')
    expect(result.current.tracks[0].embeddedCoverDims).toEqual({ w: 600, h: 600 })
    expect(result.current.tracks[0].duration).toBe(345)
  })

  // The conversion that triggers this already succeeded, so a failed re-read means the
  // row is merely stale, not the file unreadable. Flagging it would tell the user their
  // freshly written file is broken when it is fine.
  it('leaves the row untouched and unflagged when the read fails', async () => {
    const { result } = setupWith(
      vi
        .fn()
        .mockResolvedValueOnce({
          tags: { title: 'Old', artist: 'Old Artist' },
          duration: 100,
          cover: { thumbUrl: 'data:image/jpeg;base64,OLD', width: 300, height: 300 },
          foreignTags: [],
        })
        .mockRejectedValueOnce(new Error('EBUSY')),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))
    const id = result.current.tracks[0].id

    await act(() => result.current.refreshTrackFromDisk(id, '/m/a.wav'))

    expect(result.current.tracks[0].listLabel).toBe('Old')
    expect(result.current.tracks[0].embeddedCover).toBe('data:image/jpeg;base64,OLD')
    expect(result.current.tracks[0].metaReadFailed).toBeUndefined()
  })

  // The row and the editor read the artwork from two different fields — the list from
  // embeddedCover, the editor's preview from coverUrl — so refreshing only the first left
  // the editor showing the pre-conversion image. The user's fix was to remove the track,
  // load it again and update a second time, which is retouching the whole collection
  // twice. Both fields describe the same bytes on disk, so both have to be re-read.
  it('refreshes the cover the editor shows, not just the one in the list', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'On Disk', artist: 'On Disk Artist' },
        duration: 200,
        cover: { thumbUrl: 'data:image/jpeg;base64,NEW', width: 700, height: 700 },
        foreignTags: [],
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))
    const id = result.current.tracks[0].id
    act(() => {
      result.current.updateTrack(id, { coverUrl: 'data:image/jpeg;base64,STALE' })
    })

    await act(() => result.current.refreshTrackFromDisk(id, '/m/a.wav'))

    expect(result.current.tracks[0].coverUrl).toBe('data:image/jpeg;base64,NEW')
  })

  // Removing the artwork and updating leaves the file with none, so the editor must show
  // none either. The staged "remove" flag has to clear too: it already happened, and a
  // flag that outlives its export makes the next one think the user wants it stripped
  // again — the row would keep claiming a removal the disk already reflects.
  it('clears the cover and the staged removal once the export has stripped it', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'On Disk', artist: 'On Disk Artist' },
        duration: 200,
        cover: null,
        foreignTags: [],
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))
    const id = result.current.tracks[0].id
    act(() => {
      result.current.updateTrack(id, {
        coverUrl: 'data:image/jpeg;base64,OLD',
        coverRemoved: true,
      })
    })

    await act(() => result.current.refreshTrackFromDisk(id, '/m/a.wav'))

    expect(result.current.tracks[0].coverUrl).toBeUndefined()
    expect(result.current.tracks[0].coverRemoved).toBeFalsy()
  })

  // The refresh describes the file, nothing else: whatever the user has staged in the
  // editor — typed metadata, an applied match — was not part of what changed on disk
  // and must survive a conversion untouched.
  it('keeps the editor state out of the refresh', async () => {
    const { result } = setupWith(
      vi.fn().mockResolvedValue({
        tags: { title: 'On Disk', artist: 'On Disk Artist' },
        duration: 200,
        cover: null,
        foreignTags: [],
      }),
    )
    await act(() => result.current.addPaths(['/m/a.wav']))
    const id = result.current.tracks[0].id
    act(() => {
      result.current.updateTrack(id, {
        meta: { ...result.current.tracks[0].meta, title: 'Typed By User' },
        matched: true,
      })
    })

    await act(() => result.current.refreshTrackFromDisk(id, '/m/a.wav'))

    expect(result.current.tracks[0].meta.title).toBe('Typed By User')
    expect(result.current.tracks[0].matched).toBe(true)
    expect(result.current.tracks[0].listLabel).toBe('On Disk')
  })
})
