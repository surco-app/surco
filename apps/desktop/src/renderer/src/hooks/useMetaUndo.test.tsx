// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { emptyMetadata } from '../../../shared/metadata'
import type { TrackMetadata } from '../../../shared/types'
import type { TrackItem } from '../types'
import { MAX_META_UNDO, useMetaUndo } from './useMetaUndo'

function track(id: string, meta: Partial<TrackMetadata> = {}, extra: Partial<TrackItem> = {}): TrackItem {
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
function setup(initial: TrackItem[]) {
  return renderHook(() => {
    const [tracks, setTracks] = useState(initial)
    const tracksRef = useRef(tracks)
    tracksRef.current = tracks
    const undo = useMetaUndo(tracksRef, setTracks)
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
      track('a', { title: 'Matched' }, { matched: true, matchConfidence: 0.93, inAppleMusicResolved: true }),
    ])
    act(() => {
      cleared.result.current.record(cleared.result.current.tracks)
      cleared.result.current.setTracks((prev) =>
        prev.map((t) => ({
          ...t,
          meta: emptyMetadata(),
          matched: false,
          matchConfidence: undefined,
          inAppleMusicResolved: false,
        })),
      )
    })
    act(() => {
      cleared.result.current.undo()
    })
    const restored = cleared.result.current.tracks[0]
    expect(restored.matched).toBe(true)
    expect(restored.matchConfidence).toBe(0.93)
    expect(restored.inAppleMusicResolved).toBe(true)
  })

  // Two successive operations must unwind in reverse order, or undoing after a
  // fill-then-replace would resurrect the intermediate state instead of stepping back.
  it('undoes the most recent operation first', () => {
    const { result } = setup([track('a', { title: 'v1' })])
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) => prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'v2' } })))
    })
    act(() => {
      result.current.record(result.current.tracks)
      result.current.setTracks((prev) => prev.map((t) => ({ ...t, meta: { ...t.meta, title: 'v3' } })))
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
        result.current.setTracks((prev) => prev.map((t) => ({ ...t, meta: { ...t.meta, title: `v${i}` } })))
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
})
