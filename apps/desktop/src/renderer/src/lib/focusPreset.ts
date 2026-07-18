// The two header "focus" presets. Each parks the search-results column at a width tuned
// for a task; the editor is flex-1, so it takes whatever results leaves — wider under
// 'match' (results wide to scan for the release), narrower under 'edit' (results at its
// minimum so the editor takes over). A single click reparks it instead of dragging the
// divider. The list column is left untouched: it stays wherever the user dragged it,
// independent of the focus. A dropped third preset ('balanced', 315) sat 15px from 'edit'
// and read as the same state — two well-separated presets carry the same intent clearly.
export type FocusPresetId = 'match' | 'edit'

export interface FocusPreset {
  id: FocusPresetId
  resultsWidth: number
}

// Widths stay inside the results drag range (300–720) so a preset reads back as active
// until the user drags off it.
export const FOCUS_PRESETS: readonly FocusPreset[] = [
  { id: 'match', resultsWidth: 480 },
  { id: 'edit', resultsWidth: 300 },
]

// A fresh crate opens on 'match': the first task on an import is finding the release, so
// results starts wide and the match preset reads as active from the first paint.
export const DEFAULT_RESULTS_WIDTH = 480

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
