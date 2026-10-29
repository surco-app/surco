// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import { trackSignature } from '../lib/dirty'
import type { TrackItem } from '../types'
import { MAX_META_UNDO, useMetaUndo } from './useMetaUndo'

function track(
  id: string,
  meta: Partial<TrackMetadata> = {},
  extra: Partial<TrackItem> = {},
): TrackItem {
  return {
    id,
    inputPath: `/${id}.wav`,
    fileName: id,
    listLabel: meta.title ?? id,
    query: '',
    status: 'idle',
    meta: { ...emptyMetadata(), ...meta },
    ...extra,
  }
}

// A harness owning the tracks state the way App does, so record/undo run against the
// same setTracks contract the real hook receives.
function setup(initial: TrackItem[], matchFlips: Parameters<typeof useMetaUndo>[2] = {}) {
  return renderHook(() => {
    const [tracks, setTracks] = useState(initial)
    const tracksRef = useRef(tracks)
    tracksRef.current = tracks
    const undo = useMetaUndo(tracksRef, setTracks, matchFlips)
    return { tracks, setTracks, ...undo }
  })
}

describe('useMetaUndo', () => {
  // Batch tag operations (fill-all, find & replace, clear, paste) overwrite work with no
  // other way back — undo must restore exactly what the fields held before the sweep.
  it('restores the recorded metadata after a batch overwrite', () => {
    const { result } = setup([track('a', { title: 'Original', artist: 'Keep Me' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Clobbered', artist: '' } })),
      )
    })
    let restored = 0
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(1)
    expect(result.current.tracks[0].meta.title).toBe('Original')
    expect(result.current.tracks[0].meta.artist).toBe('Keep Me')
  })

  // Clearing metadata also un-matches the track (matched/review flags drop so the sweep
  // re-probes). Undoing the clear must bring those flags back, or a restored track would
  // get silently re-matched and overwritten by the next sweep.
  it('restores the match flags a clear dropped', () => {
    const cleared = setup([
      track(
        'a',
        { title: 'Matched' },
        { matched: true, matchConfidence: 0.93, inLibraryResolved: true },
      ),
    ])
    act(() => {
      cleared.result.current.record(cleared.result.current.tracks)
      cleared.result.current.setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          meta: emptyMetadata(),
          matched: false,
          matchConfidence: undefined,
          inLibraryResolved: false,
        })),
      )
    })
    act(() => {
      cleared.result.current.undo()
    })
    const restored = cleared.result.current.tracks[0]
    expect(restored.matched).toBe(true)
    expect(restored.matchConfidence).toBe(0.93)
    expect(restored.inLibraryResolved).toBe(true)
  })

  // "Clear all" doesn't just empty the fields — it flags the track for a full wipe on
  // convert (metaCleared/coverRemoved) and marks every foreign tag for deletion
  // (foreignRemoved). Undoing must clear those intents too, or after ⌘Z the inspector
  // still shows the foreign tags struck through and the next convert still wipes them.
  it('reverts the clear-all intents (metaCleared, coverRemoved, foreignRemoved)', () => {
    const { result } = setup([
      track('a', { title: 'Keep' }, { foreignTags: [{ name: 'SERATO_MARKERS_V2', value: 'x' }] }),
    ])
    act(() => {
      result.current.record(result.current.tracks)
      // What clearAllMeta stamps onto the track.
      result.current.setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          meta: emptyMetadata(),
          metaCleared: true,
          coverRemoved: true,
          foreignRemoved: ['SERATO_MARKERS_V2'],
        })),
      )
    })
    act(() => {
      result.current.undo()
    })
    const restored = result.current.tracks[0]
    expect(restored.meta.title).toBe('Keep')
    expect(restored.metaCleared).toBeUndefined()
    expect(restored.coverRemoved).toBeUndefined()
    expect(restored.foreignRemoved).toBeUndefined()
  })

  // Two successive operations must unwind in reverse order, or undoing after a
  // fill-then-replace would resurrect the intermediate state instead of stepping back.
  it('undoes the most recent operation first', () => {
    const { result } = setup([track('a', { title: 'v1' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'v2' } })),
      )
    })
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'v3' } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.title).toBe('v2')
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.title).toBe('v1')
  })

  // A track removed between the edit and the undo must not resurrect or crash — the
  // remaining recorded tracks still restore, and the count reflects what actually changed.
  it('skips tracks that were removed since the edit', () => {
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.filter((t) => t.id !== 'b').map((t) => ({ ...t, meta: { ...t.meta, title: 'X' } })),
      )
    })
    let restored = 0
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(1)
    expect(result.current.tracks).toHaveLength(1)
    expect(result.current.tracks[0].meta.title).toBe('A')
  })

  // Pasting a copied tag set also stamps the cover, so its undo must bring the old
  // cover back — but ONLY for cover-recording operations: a plain find & replace
  // snapshot must never revert a cover the user changed afterwards.
  it('restores the cover only when the operation recorded it', () => {
    const withCover = setup([
      track('a', { title: 'A' }, { coverUrl: 'data:old', coverPath: '/covers/old.jpg' }),
    ])
    act(() => {
      withCover.result.current.record(withCover.result.current.tracks, { cover: true })
      withCover.result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, coverUrl: 'data:pasted', coverPath: undefined })),
      )
    })
    act(() => {
      withCover.result.current.undo()
    })
    expect(withCover.result.current.tracks[0].coverUrl).toBe('data:old')
    expect(withCover.result.current.tracks[0].coverPath).toBe('/covers/old.jpg')

    const metaOnly = setup([track('a', { title: 'A' }, { coverUrl: 'data:old' })])
    act(() => {
      metaOnly.result.current.record(metaOnly.result.current.tracks)
      metaOnly.result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'X' }, coverUrl: 'data:newer' })),
      )
    })
    act(() => {
      metaOnly.result.current.undo()
    })
    expect(metaOnly.result.current.tracks[0].meta.title).toBe('A')
    expect(metaOnly.result.current.tracks[0].coverUrl).toBe('data:newer')
  })

  // ⌘Z with nothing recorded must be a harmless no-op — the caller uses the 0 to skip
  // its "restored" toast, and canUndo gates the palette entry.
  it('reports an empty stack instead of touching state', () => {
    const { result } = setup([track('a', { title: 'A' })])
    expect(result.current.canUndo()).toBe(false)
    let restored = -1
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(0)
    expect(result.current.tracks[0].meta.title).toBe('A')
    act(() => {
      result.current.record(result.current.tracks)
    })
    expect(result.current.canUndo()).toBe(true)
  })

  // The stack is bounded so a long session can't grow it forever; past the cap the
  // oldest snapshots fall off while the newest MAX_META_UNDO still unwind.
  it('drops the oldest entries beyond the cap', () => {
    const { result } = setup([track('a', { title: 'v0' })])
    for (let i = 1; i <= MAX_META_UNDO + 1; i++) {
      act(() => {
        result.current.record(result.current.tracks)
        result.current.setTracks((prev) =>
          prev.map((t) => ({ ...t, meta: { ...t.meta, title: `v${i}` } })),
        )
      })
    }
    for (let i = 0; i < MAX_META_UNDO; i++) {
      act(() => {
        result.current.undo()
      })
    }
    expect(result.current.tracks[0].meta.title).toBe('v1')
    expect(result.current.canUndo()).toBe(false)
  })

  it('folds every track a sweep touches into one step, so a single undo takes back the whole sweep', () => {
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })])
    for (const id of ['a', 'b']) {
      act(() => {
        result.current.record(
          result.current.tracks.filter((t) => t.id === id),
          { group: 'sweep-1' },
        )
        result.current.setTracks((prev) =>
          prev.map((t) => (t.id === id ? { ...t, meta: { ...t.meta, title: 'Matched' } } : t)),
        )
      })
    }
    let restored = 0
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(2)
    expect(result.current.tracks.map((t) => t.meta.title)).toEqual(['A', 'B'])
    expect(result.current.canUndo()).toBe(false)
  })

  it('opens a new sweep step once another edit lands on top, so undoing that edit never takes back the sweep with it', () => {
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })])
    act(() => {
      result.current.record([result.current.tracks[0]], { group: 'sweep-1' })
      result.current.setTracks((prev) =>
        prev.map((t) => (t.id === 'a' ? { ...t, meta: { ...t.meta, title: 'Matched' } } : t)),
      )
    })
    act(() => {
      result.current.record([result.current.tracks[0]])
      result.current.setTracks((prev) =>
        prev.map((t) => (t.id === 'a' ? { ...t, meta: { ...t.meta, title: 'Typed' } } : t)),
      )
    })
    act(() => {
      result.current.record([result.current.tracks[1]], { group: 'sweep-1' })
      result.current.setTracks((prev) =>
        prev.map((t) => (t.id === 'b' ? { ...t, meta: { ...t.meta, title: 'Matched' } } : t)),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks.map((t) => t.meta.title)).toEqual(['Typed', 'B'])
  })

  it('keeps the first snapshot of a track the same sweep touches twice, so undo returns to before the sweep', () => {
    const { result } = setup([track('a', { title: 'A' })])
    for (const title of ['First', 'Second']) {
      act(() => {
        result.current.record(result.current.tracks, { group: 'sweep-1' })
        result.current.setTracks((prev) => prev.map((t) => ({ ...t, meta: { ...t.meta, title } })))
      })
    }
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.title).toBe('A')
  })

  it('keeps a title fixed by hand after a fill-all when the fill-all is undone, so undo never eats work done since', () => {
    const { result } = setup([track('a', { title: '', album: '' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Filled', album: 'Filled Album' } })),
      )
    })
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Hand Fixed' } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.title).toBe('Hand Fixed')
    expect(result.current.tracks[0].meta.album).toBe('')
  })

  it('leaves fields the step never touched alone, so a later hand edit to them survives the undo', () => {
    const { result } = setup([track('a', { title: 'A', artist: 'Old' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, artist: 'Filled' } })),
      )
    })
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Typed', custom: { mood: 'Dark' } } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.artist).toBe('Old')
    expect(result.current.tracks[0].meta.title).toBe('Typed')
    expect(result.current.tracks[0].meta.custom).toEqual({ mood: 'Dark' })
  })

  it('keeps a field typed between two presses of a grouped cover step when that step is undone', () => {
    const { result } = setup([track('a', { title: 'A' }, { coverUrl: 'data:own' })])
    const press = (coverUrl: string) =>
      act(() => {
        result.current.record(result.current.tracks, { cover: true, group: 'cover-a' })
        result.current.setTracks((prev) => prev.map((t) => ({ ...t, coverUrl })))
      })
    press('data:1')
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Typed' } })),
      )
    })
    press('data:2')
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].coverUrl).toBe('data:own')
    expect(result.current.tracks[0].meta.title).toBe('Typed')
  })

  it('reapplies an undone step with redo, so a ⌘Z pressed one time too many costs nothing', () => {
    const { result } = setup([track('a', { title: 'A', album: '' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Filled', album: 'Filled Album' } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(result.current.canRedo()).toBe(true)
    let reapplied = 0
    act(() => {
      reapplied = result.current.redo()
    })
    expect(reapplied).toBe(1)
    expect(result.current.tracks[0].meta.title).toBe('Filled')
    expect(result.current.tracks[0].meta.album).toBe('Filled Album')
    expect(result.current.canRedo()).toBe(false)
    act(() => {
      result.current.undo()
    })
    expect(result.current.tracks[0].meta.title).toBe('A')
  })

  it('keeps a field typed after an undo when the step is redone, as undo does for the other direction', () => {
    const { result } = setup([track('a', { title: 'A', album: '' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Filled', album: 'Filled Album' } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Typed' } })),
      )
    })
    act(() => {
      result.current.redo()
    })
    expect(result.current.tracks[0].meta.title).toBe('Typed')
    expect(result.current.tracks[0].meta.album).toBe('Filled Album')
  })

  it('drops the redo step once a new edit is recorded, so redo never replays over newer work', () => {
    const { result } = setup([track('a', { title: 'A' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'First' } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Second' } })),
      )
    })
    expect(result.current.canRedo()).toBe(false)
    let reapplied = -1
    act(() => {
      reapplied = result.current.redo()
    })
    expect(reapplied).toBe(0)
    expect(result.current.tracks[0].meta.title).toBe('Second')
  })

  it('leaves a converted track with no custom fields matching its converted signature after undoing a paste that added one, so it does not read as stale', () => {
    const { result } = setup([track('a', { title: 'A' })])
    const converted = trackSignature(result.current.tracks[0])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, custom: { mood: 'Dark' } } })),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(trackSignature(result.current.tracks[0])).toBe(converted)
  })

  it('reports nothing undone and offers no redo when every field the step changed was edited since, so the toast never claims a restore that did not happen', () => {
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Filled' } })),
      )
    })
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: `Typed ${t.id}` } })),
      )
    })
    let restored = -1
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(0)
    expect(result.current.canUndo()).toBe(false)
    expect(result.current.canRedo()).toBe(false)
    expect(result.current.tracks.map((t) => t.meta.title)).toEqual(['Typed a', 'Typed b'])
  })

  it('counts only the tracks an undo actually changed', () => {
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'Filled' } })),
      )
    })
    act(() => {
      result.current.setTracks((prev) =>
        prev.map((t) => (t.id === 'b' ? { ...t, meta: { ...t.meta, title: 'Typed' } } : t)),
      )
    })
    let restored = -1
    act(() => {
      restored = result.current.undo()
    })
    expect(restored).toBe(1)
    expect(result.current.tracks.map((t) => t.meta.title)).toEqual(['A', 'Typed'])
  })

  it('names the tracks an undo took a match off, so the sweep can leave them unmatched instead of matching them again', () => {
    const onMatchUndone = vi.fn()
    const onMatchRedone = vi.fn()
    const { result } = setup([track('a', { title: 'A' }), track('b', { title: 'B' })], {
      onMatchUndone,
      onMatchRedone,
    })
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) =>
        prev.map((t) =>
          t.id === 'a'
            ? { ...t, meta: { ...t.meta, album: 'Album' }, autoMatched: true }
            : { ...t, meta: { ...t.meta, album: 'Typed' } },
        ),
      )
    })
    act(() => {
      result.current.undo()
    })
    expect(onMatchUndone).toHaveBeenCalledWith(['a'])
    expect(onMatchRedone).not.toHaveBeenCalled()
    act(() => {
      result.current.redo()
    })
    expect(onMatchRedone).toHaveBeenCalledWith(['a'])
    expect(onMatchUndone).toHaveBeenCalledTimes(1)
  })

  describe('picked cover blobs', () => {
    const url = URL as unknown as Record<string, unknown>
    const original = url.revokeObjectURL
    afterEach(() => {
      url.revokeObjectURL = original
    })
    function spyRevoke(): ReturnType<typeof vi.fn> {
      const revoke = vi.fn()
      url.revokeObjectURL = revoke
      return revoke
    }
    function coverStep(
      result: ReturnType<typeof setup>['result'],
      id: string,
      coverUrl: string,
    ): void {
      act(() => {
        result.current.record(
          result.current.tracks.filter((t) => t.id === id),
          { cover: true },
        )
        result.current.setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, coverUrl } : t)))
      })
    }

    it('frees a blob only a snapshot falling off the full stack still held, so long sessions do not pin every replaced image', () => {
      const revoke = spyRevoke()
      const { result } = setup([track('a', {}, { coverUrl: 'blob:first' })])
      for (let i = 0; i <= MAX_META_UNDO; i++) coverStep(result, 'a', `blob:${i}`)
      expect(revoke).toHaveBeenCalledWith('blob:first')
    })

    it('keeps a blob falling off the stack that another row still shows, so that row keeps its artwork', () => {
      const revoke = spyRevoke()
      const { result } = setup([
        track('a', {}, { coverUrl: 'blob:shared' }),
        track('b', {}, { coverUrl: 'blob:shared' }),
      ])
      for (let i = 0; i <= MAX_META_UNDO; i++) coverStep(result, 'a', `blob:${i}`)
      expect(revoke).not.toHaveBeenCalledWith('blob:shared')
    })

    it('keeps a blob falling off the stack that a newer snapshot still holds, so that undo can still show it', () => {
      const revoke = spyRevoke()
      const { result } = setup([
        track('a', {}, { coverUrl: 'blob:shared' }),
        track('b', {}, { coverUrl: 'blob:shared' }),
      ])
      coverStep(result, 'a', 'blob:a1')
      coverStep(result, 'b', 'blob:b1')
      for (let i = 0; i < MAX_META_UNDO - 1; i++) coverStep(result, 'a', `blob:${i}`)
      expect(revoke).not.toHaveBeenCalledWith('blob:shared')
    })

    it('keeps the blob an undo takes off a row alive, so redo can show it again', () => {
      const revoke = spyRevoke()
      const { result } = setup([track('a', {}, { coverUrl: 'data:own' })])
      coverStep(result, 'a', 'blob:picked')
      act(() => {
        result.current.undo()
      })
      expect(result.current.tracks[0].coverUrl).toBe('data:own')
      expect(revoke).not.toHaveBeenCalled()
      act(() => {
        result.current.redo()
      })
      expect(result.current.tracks[0].coverUrl).toBe('blob:picked')
    })

    it('frees the blob an undo took off a row once a new edit drops the redo step, and never the one undo put back', () => {
      const revoke = spyRevoke()
      const { result } = setup([track('a', {}, { coverUrl: 'data:own' })])
      coverStep(result, 'a', 'blob:picked')
      coverStep(result, 'a', 'blob:second')
      act(() => {
        result.current.undo()
      })
      coverStep(result, 'a', 'data:other')
      expect(revoke).toHaveBeenCalledWith('blob:second')
      expect(revoke).not.toHaveBeenCalledWith('blob:picked')
    })
  })
})
