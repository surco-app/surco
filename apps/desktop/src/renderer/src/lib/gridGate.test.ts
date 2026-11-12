import { describe, expect, it } from 'vitest'
import type { EditableGrid } from '../../../shared/gridEdit'
import { gridGate } from './gridGate'

const GRID: EditableGrid = { bpm: 128, anchorMs: 0 }
const ZONED: EditableGrid = {
  bpm: 128,
  anchorMs: 0,
  zones: [{ fromMs: 60000, bpm: 130, anchorMs: 60010 }],
}
const open = {
  contentId: '103',
  read: { analysed: true, clockLeadMs: null },
  grid: GRID,
  onSurcoGrid: false,
}

describe('gridGate', () => {
  it('closes the grid where the editor closes Auto', () => {
    expect(gridGate(open)).toBeNull()
    expect(gridGate({ ...open, contentId: 'serato:/a.mp3' })).toBe('editor.cues.grid.serato')
    expect(gridGate({ ...open, contentId: 'traktor:/a.mp3' })).toBe('editor.cues.grid.unmeasured')
    expect(
      gridGate({ ...open, contentId: 'traktor:/a.mp3', read: { analysed: true, clockLeadMs: 26 } }),
    ).toBeNull()
    expect(gridGate({ ...open, read: { analysed: false } })).toBe('editor.cues.grid.provisional')
    expect(gridGate({ ...open, onSurcoGrid: true })).toBe('editor.cues.grid.surcoDraft')
    expect(gridGate({ ...open, grid: null })).toBe('editor.cues.grid.varying')
    expect(gridGate({ ...open, grid: ZONED })).toBeNull()
    expect(
      gridGate({
        ...open,
        contentId: 'engine:7',
        read: { analysed: true, clockLeadMs: 0 },
        grid: ZONED,
      }),
    ).toBe('editor.cues.grid.varying')
  })
})
