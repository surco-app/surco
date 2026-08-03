import { describe, expect, it } from 'vitest'
import type { TrackItem } from '../types'
import { sameTracks } from './sameTracks'

const track = (id: string): TrackItem => ({ id }) as TrackItem

// Filtering and sorting mint a fresh array on every pass, so the visible list changed
// identity on any track edit — a metadata patch, a waveform landing, a conversion moving
// to its next stage — even when the rows on screen were the exact same objects in the
// exact same order. That broke the memo on the list for a render that had nothing to show
// for it. Comparing element identity is what lets the previous array be handed back.
describe('sameTracks', () => {
  it('treats a rebuilt array of the same rows in the same order as unchanged', () => {
    const [a, b] = [track('a'), track('b')]
    expect(sameTracks([a, b], [a, b])).toBe(true)
  })

  it('sees a reorder as a change, since the list paints in order', () => {
    const [a, b] = [track('a'), track('b')]
    expect(sameTracks([a, b], [b, a])).toBe(false)
  })

  // The identity check must be by object, not by id: updateTrack replaces the row object
  // when a field changes, and that new object is exactly what the rows have to re-render
  // for. Matching on id would hand back the stale array and freeze the row's own updates.
  it('sees a replaced row object as a change even when the id is the same', () => {
    const a = track('a')
    expect(sameTracks([a], [track('a')])).toBe(false)
  })

  it('sees an added or removed row as a change', () => {
    const [a, b] = [track('a'), track('b')]
    expect(sameTracks([a], [a, b])).toBe(false)
    expect(sameTracks([a, b], [a])).toBe(false)
  })

  it('treats two empty lists as unchanged', () => {
    expect(sameTracks([], [])).toBe(true)
  })
})
