import { describe, expect, it } from 'vitest'
import { activeFocusPreset, FOCUS_PRESETS, focusPresetWidth } from './focusPreset'

describe('FOCUS_PRESETS', () => {
  it('lists match, balanced and edit in that left-to-right order', () => {
    expect(FOCUS_PRESETS.map((p) => p.id)).toEqual(['match', 'balanced', 'edit'])
  })

  // Every preset's results width must stay inside the range the drag handle enforces
  // (300–720) — a preset that lands out of range would snap on the next drag and never
  // read back as active.
  it('keeps every results width within the resizable range', () => {
    for (const p of FOCUS_PRESETS) {
      expect(p.resultsWidth).toBeGreaterThanOrEqual(300)
      expect(p.resultsWidth).toBeLessThanOrEqual(720)
    }
  })

  // 'balanced' is the app's default results width (315), so a fresh crate — which sits at
  // that default — shows balanced already lit rather than no preset at all.
  it('sets balanced to the default results width so a fresh crate reads as balanced', () => {
    expect(focusPresetWidth('balanced')).toBe(315)
  })

  // The editor is flex-1, so it grows as results shrinks. 'match' gives results the most
  // room (editor waits); 'edit' pinches results to its minimum (editor widest).
  it('gives results its widest column under match and its narrowest under edit', () => {
    expect(focusPresetWidth('match')).toBeGreaterThan(focusPresetWidth('balanced'))
    expect(focusPresetWidth('balanced')).toBeGreaterThan(focusPresetWidth('edit'))
  })
})

describe('activeFocusPreset', () => {
  it('names the preset whose results width the column currently matches', () => {
    expect(activeFocusPreset(focusPresetWidth('match'))).toBe('match')
    expect(activeFocusPreset(focusPresetWidth('balanced'))).toBe('balanced')
  })

  // A drag to any in-between width belongs to no preset, so the segmented control shows
  // nothing selected — the same "custom" state a manually-sized editor shows in VS Code.
  it('is null once a drag moves the column off every preset', () => {
    expect(activeFocusPreset(517)).toBeNull()
  })
})
