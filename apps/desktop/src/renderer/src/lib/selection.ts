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
    // Adding keeps the current anchor, so building a multi-selection never re-keys the
    // editor — its in-flight Discogs search and loaded results survive instead of being
    // torn down and refetched. Removing only moves the anchor when the anchor itself went.
    const anchor = has
      ? state.anchor === id
        ? (ids[ids.length - 1] ?? null)
        : state.anchor
      : (state.anchor ?? id)
    return { ids, anchor }
  }
  return { ids: [id], anchor: id }
}

// Drops `id` from the selection — used when a track is removed from the list — and
// moves the anchor onto a still-selected track so the editor never points at a gone row.
export function deselect(state: Selection, id: string): Selection {
  const ids = state.ids.filter((x) => x !== id)
  return { ids, anchor: state.anchor === id ? (ids[ids.length - 1] ?? null) : state.anchor }
}

// After the view narrows (a quality-filter change hides rows), the anchor may no longer
// be on screen — its editor would linger out of view and the position pill read "‒/N".
// Returns the selection to fall back to: the first still-visible track, or an empty
// selection when the view is empty. Returns null when the anchor is still visible (or
// there is none), meaning keep the current selection untouched. Pure so the effect that
// calls it stays a one-liner and the fall-back rule is testable without a DOM.
export function reanchorToVisible(visibleIds: string[], anchor: string | null): Selection | null {
  if (!anchor || visibleIds.includes(anchor)) return null
  const first = visibleIds[0]
  return first ? { ids: [first], anchor: first } : { ids: [], anchor: null }
}
