import { describe, expect, it } from 'vitest'
import { clickSelect, deselect, reanchorToVisible, type Selection } from './selection'

const ORDER = ['a', 'b', 'c', 'd']
const empty: Selection = { ids: [], anchor: null }

describe('clickSelect', () => {
  it('selects a single track on a plain click', () => {
    expect(clickSelect(empty, ORDER, 'b', {})).toEqual({ ids: ['b'], anchor: 'b' })
  })

  it('replaces the whole selection on a plain click', () => {
    // A plain click is "start over with just this one", so an existing multi-selection
    // collapses rather than growing — the common case after a Cmd/Shift selection.
    const state: Selection = { ids: ['a', 'b'], anchor: 'b' }
    expect(clickSelect(state, ORDER, 'd', {})).toEqual({ ids: ['d'], anchor: 'd' })
  })

  it('adds a track with Cmd-click but keeps the anchor so the editor is not re-keyed', () => {
    // Moving the anchor to the newly added track would remount the editor and refetch its
    // Discogs search; keeping it lets an in-progress search survive building the selection.
    const state: Selection = { ids: ['a'], anchor: 'a' }
    expect(clickSelect(state, ORDER, 'c', { meta: true })).toEqual({
      ids: ['a', 'c'],
      anchor: 'a',
    })
  })

  it('keeps the anchor when Cmd-clicking off a track that is not the anchor', () => {
    const state: Selection = { ids: ['a', 'b', 'c'], anchor: 'a' }
    expect(clickSelect(state, ORDER, 'c', { meta: true })).toEqual({ ids: ['a', 'b'], anchor: 'a' })
  })

  it('removes a track with Cmd-click when it is already selected', () => {
    const state: Selection = { ids: ['a', 'c'], anchor: 'c' }
    expect(clickSelect(state, ORDER, 'a', { meta: true })).toEqual({ ids: ['c'], anchor: 'c' })
  })

  it('moves the anchor to the last remaining pick when Cmd-clicking it off', () => {
    // The anchor drives the editor, so toggling it off must hand that role to a track
    // that is still selected, never leave it pointing at a deselected row.
    const state: Selection = { ids: ['a', 'c'], anchor: 'c' }
    expect(clickSelect(state, ORDER, 'c', { meta: true })).toEqual({ ids: ['a'], anchor: 'a' })
  })

  it('clears the anchor when Cmd-clicking the only selected track off', () => {
    const state: Selection = { ids: ['b'], anchor: 'b' }
    expect(clickSelect(state, ORDER, 'b', { meta: true })).toEqual({ ids: [], anchor: null })
  })

  it('extends a contiguous range from the anchor on Shift-click', () => {
    const state: Selection = { ids: ['b'], anchor: 'b' }
    expect(clickSelect(state, ORDER, 'd', { shift: true })).toEqual({
      ids: ['b', 'c', 'd'],
      anchor: 'b',
    })
  })

  it('ranges upward too, keeping the anchor fixed as the pivot', () => {
    const state: Selection = { ids: ['c'], anchor: 'c' }
    expect(clickSelect(state, ORDER, 'a', { shift: true })).toEqual({
      ids: ['a', 'b', 'c'],
      anchor: 'c',
    })
  })

  it('falls back to a single selection when Shift-clicking with no anchor', () => {
    expect(clickSelect(empty, ORDER, 'c', { shift: true })).toEqual({ ids: ['c'], anchor: 'c' })
  })
})

describe('deselect', () => {
  it('drops the id and keeps the anchor when another track was primary', () => {
    const state: Selection = { ids: ['a', 'b', 'c'], anchor: 'a' }
    expect(deselect(state, 'b')).toEqual({ ids: ['a', 'c'], anchor: 'a' })
  })

  it('moves the anchor onto a still-selected track when the primary is removed', () => {
    const state: Selection = { ids: ['a', 'b'], anchor: 'a' }
    expect(deselect(state, 'a')).toEqual({ ids: ['b'], anchor: 'b' })
  })

  it('clears the anchor when the last selected track is removed', () => {
    const state: Selection = { ids: ['a'], anchor: 'a' }
    expect(deselect(state, 'a')).toEqual({ ids: [], anchor: null })
  })
})

describe('reanchorToVisible', () => {
  // The whole point: a filter that hides the selected track used to leave the editor on a
  // row no longer in the list and the position pill reading "–/N". Fall to the first
  // visible track so both point at something on screen.
  it('falls to the first visible track when the anchor was filtered out', () => {
    expect(reanchorToVisible(['c', 'd'], 'a')).toEqual({ ids: ['c'], anchor: 'c' })
  })

  it('keeps the current selection when the anchor is still visible', () => {
    expect(reanchorToVisible(['a', 'b', 'c'], 'b')).toBeNull()
  })

  it('clears the selection when the filter leaves nothing visible', () => {
    expect(reanchorToVisible([], 'a')).toEqual({ ids: [], anchor: null })
  })

  it('does nothing when there was no selection to begin with', () => {
    expect(reanchorToVisible(['a', 'b'], null)).toBeNull()
  })
})
