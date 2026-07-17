// The three header "focus" presets. Each parks the search-results column at a width tuned
// for a task; the editor is flex-1, so it takes whatever results leaves — widest under
// 'edit' (results at its minimum), narrowest under 'match' (results wide to scan). A single
// click reparks it instead of dragging the divider. The list column is left untouched: it
// stays wherever the user dragged it, independent of the focus.
export type FocusPresetId = 'match' | 'balanced' | 'edit'

export interface FocusPreset {
  id: FocusPresetId
  resultsWidth: number
}

// Widths stay inside the results drag range (300–720) so a preset reads back as active
// until the user drags off it. 'balanced' is 315 — the app's default results width — so a
// fresh crate shows it already selected.
export const FOCUS_PRESETS: readonly FocusPreset[] = [
  { id: 'match', resultsWidth: 480 },
  { id: 'balanced', resultsWidth: 315 },
  { id: 'edit', resultsWidth: 300 },
]

export function focusPresetWidth(id: FocusPresetId): number {
  const preset = FOCUS_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`unknown focus preset: ${id}`)
  return preset.resultsWidth
}

// The preset the results column's width currently matches, or null when a drag has moved
// it to an in-between size that belongs to no preset — the segmented control then shows
// nothing selected.
export function activeFocusPreset(resultsWidth: number): FocusPresetId | null {
  return FOCUS_PRESETS.find((p) => p.resultsWidth === resultsWidth)?.id ?? null
}
