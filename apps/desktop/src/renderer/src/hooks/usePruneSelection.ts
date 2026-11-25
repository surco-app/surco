import { useState } from 'react'
import type { PlaylistSource } from '../../../shared/types'
import { pruneToVisible, reanchorToVisible, type Selection } from '../lib/selection'
import type { FilterSelection } from '../lib/triage'
import type { TrackItem } from '../types'

interface PruneSelectionInputs {
  filterSelection: FilterSelection
  deferredSearch: string
  source: PlaylistSource | null
  playlistIds: readonly string[] | undefined
  visibleTracks: readonly Pick<TrackItem, 'id'>[]
  selection: Selection
  selectedId: string | null
  setSelectionState: (next: Selection) => void
}

// A filter change (quality bucket or format axis) can hide the selected track; left alone
// its editor lingers out of view and the position pill reads "‒/N". Drop to the first
// track the new filter shows (or clear when it shows none) so the editor and count always
// reflect what's on screen. Must react to BOTH filter axes — the format filter hiding the
// selection used to leave the list with no visible row selected. Scoped to the filters —
// not search, which changes per keystroke and would thrash the editor's per-track fetches;
// sort only reorders, never hides.
// Selected rows the new filter hides leave the selection too, so the next trash or remove
// acts only on rows the user can see.
// A search hides rows too, and an action on the selection must not reach them. Only the
// hidden extras of a selection go: when no selected row is left on screen the selection
// stays, so typing does not jump the editor from track to track on every keystroke.
// The search stays across sources, so a switch narrows the selection kept for the new
// source the same way. Keyed on its rows too: a playlist still loading shows none (nothing
// is pruned then) and its arrival is when its own rows are on screen to prune against.
export function usePruneSelection({
  filterSelection,
  deferredSearch,
  source,
  playlistIds,
  visibleTracks,
  selection,
  selectedId,
  setSelectionState,
}: PruneSelectionInputs): void {
  const [prunedFor, setPrunedFor] = useState({
    filterSelection,
    deferredSearch,
    source,
    playlistIds,
  })
  if (
    prunedFor.filterSelection !== filterSelection ||
    prunedFor.deferredSearch !== deferredSearch ||
    prunedFor.source !== source ||
    prunedFor.playlistIds !== playlistIds
  ) {
    setPrunedFor({ filterSelection, deferredSearch, source, playlistIds })
    const ids = visibleTracks.map((t) => t.id)
    const next =
      pruneToVisible(ids, selection) ??
      (prunedFor.filterSelection !== filterSelection ? reanchorToVisible(ids, selectedId) : null)
    if (next) setSelectionState(next)
  }
}
