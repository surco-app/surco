// Multi-selection state for the track list. `ids` is every selected track; `anchor`
// is the primary one — the track shown in the single-track editor and the pivot a
// Shift-click ranges from. The interaction mirrors Finder: a plain click selects one,
// Cmd toggles a track in or out, and Shift extends a contiguous range from the anchor.
export interface Selection {
  ids: string[]
  anchor: string | null
}

export interface ClickMods {
  meta?: boolean
  shift?: boolean
}

function range(order: string[], from: string, to: string): string[] {
  const i = order.indexOf(from)
  const j = order.indexOf(to)
  if (i === -1 || j === -1) return [to]
  const [lo, hi] = i <= j ? [i, j] : [j, i]
  return order.slice(lo, hi + 1)
}

// Computes the new selection after clicking `id`, given the current selection and the
// tracks' display order (needed to resolve a Shift range). Pure so the reducer can be
// tested without a DOM.
export function clickSelect(
  state: Selection,
  order: string[],
  id: string,
  mods: ClickMods = {},
): Selection {
  if (mods.shift && state.anchor) {
    return { ids: range(order, state.anchor, id), anchor: state.anchor }
  }
  if (mods.meta) {
    const has = state.ids.includes(id)
    const ids = has ? state.ids.filter((x) => x !== id) : [...state.ids, id]
    // Toggling the anchor off hands the role to the last remaining pick (or clears it
    // when nothing is left), so the editor always tracks a still-selected row.
    return { ids, anchor: has ? (ids[ids.length - 1] ?? null) : id }
  }
  return { ids: [id], anchor: id }
}

// Drops `id` from the selection — used when a track is removed from the list — and
// moves the anchor onto a still-selected track so the editor never points at a gone row.
export function deselect(state: Selection, id: string): Selection {
  const ids = state.ids.filter((x) => x !== id)
  return { ids, anchor: state.anchor === id ? (ids[ids.length - 1] ?? null) : state.anchor }
}
